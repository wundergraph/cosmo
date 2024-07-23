package core

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sync"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/dgraph-io/ristretto"
	"github.com/goccy/go-json"
	"github.com/pkg/errors"
	"github.com/valyala/fastjson"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/variablesvalidation"

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

var (
	// staticOperationName is used to replace the operation name in the document when generating the operation ID
	// this ensures that the operation ID is the same for the same operation regardless of the operation name
	staticOperationName = []byte("O")
)

type ParsedOperation struct {
	// ID represents a unique-ish ID for the operation calculated by hashing
	// its normalized representation and its variables
	ID uint64
	// Type is a string representing the operation type. One of
	// "query", "mutation", "subscription"
	Type      string
	Variables *fastjson.Object
	// Files is a list of files, an interface representing the file data needed to be passed forward.
	Files []httpclient.File
	// NormalizedRepresentation is the normalized representation of the operation
	// as a string. This is provided for modules to be able to access the
	// operation. Only available after the operation has been normalized.
	NormalizedRepresentation   string
	Request                    GraphQLRequest
	GraphQLRequestExtensions   GraphQLRequestExtensions
	IsPersistedOperation       bool
	PersistedOperationCacheHit bool
	// NormalizationCacheHit is set to true if the request is a non-persisted operation and the normalized operation was loaded from cache
	NormalizationCacheHit bool
}

type invalidExtensionsTypeError jsonparser.ValueType

func (e invalidExtensionsTypeError) Error() string {
	return fmt.Sprintf("invalid extensions type: %s, most be object or null", jsonparser.ValueType(e))
}

func (e invalidExtensionsTypeError) Message() string {
	return e.Error()
}

func (e invalidExtensionsTypeError) StatusCode() int {
	return http.StatusBadRequest
}

var (
	_ InputError = invalidExtensionsTypeError(0)
)

type OperationParserOptions struct {
	Executor                *Executor
	MaxOperationSizeInBytes int64
	PersistentOpClient      *cdn.PersistedOperationClient

	EnablePersistedOperationsCache bool
	NormalizationCache             *ristretto.Cache[uint64, NormalizationCacheEntry]
}

// OperationProcessor provides shared resources to the parseKit and OperationKit.
// It should be only instantiated once and shared across requests
type OperationProcessor struct {
	executor                *Executor
	maxOperationSizeInBytes int64
	cdn                     *cdn.PersistedOperationClient
	parseKitPool            *sync.Pool
	operationCache          *OperationCache
}

// parseKit is a helper struct to parse, normalize and validate operations
type parseKit struct {
	parser              *astparser.Parser
	doc                 *ast.Document
	keyGen              *xxhash.Digest
	normalizer          *astnormalization.OperationNormalizer
	printer             *astprinter.Printer
	normalizedOperation *bytes.Buffer
	variablesValidator  *variablesvalidation.VariablesValidator
}

type OperationCache struct {
	persistetOperationVariableNames     map[string][]string
	persistetOperationVariableNamesLock *sync.RWMutex

	persistedOperationCache     map[uint64]normalizedOperationCacheEntry
	persistedOperationCacheLock *sync.RWMutex

	normalizationCache *ristretto.Cache[uint64, NormalizationCacheEntry]
}

type persistedOperationMetadata struct {
	skipIncludeVariableNames []string
	listVariableNames        []string
}

// OperationKit provides methods to parse, normalize and validate operations.
// After each step, the operation is available as a ParsedOperation.
// It must be created for each request and freed after the request is done.
type OperationKit struct {
	cache                    *OperationCache
	data                     []byte
	operationDefinitionRef   int
	originalOperationNameRef ast.ByteSliceReference
	operationParser          *OperationProcessor
	kit                      *parseKit
	parsedOperation          *ParsedOperation
}

type GraphQLRequest struct {
	Query         string          `json:"query"`
	OperationName string          `json:"operationName"`
	Variables     json.RawMessage `json:"variables"`
	Extensions    json.RawMessage `json:"extensions"`
}

type GraphQLRequestExtensions struct {
	PersistedQuery *GraphQLRequestExtensionsPersistedQuery `json:"persistedQuery"`
}

type GraphQLRequestExtensionsPersistedQuery struct {
	Version    int    `json:"version"`
	Sha256Hash string `json:"sha256Hash"`
}

// NewOperationKit creates a new OperationKit. The kit is used to parse, normalize and validate operations.
// It allocates resources that need to be freed by calling OperationKit.Free()
func NewOperationKit(processor *OperationProcessor, data []byte, files []httpclient.File) *OperationKit {
	return &OperationKit{
		operationParser:        processor,
		kit:                    processor.getKit(),
		operationDefinitionRef: -1,
		data:                   data,
		cache:                  processor.operationCache,
		parsedOperation: &ParsedOperation{
			Files: files,
		},
	}
}

// Free releases the resources used by the OperationKit
func (o *OperationKit) Free() {
	o.operationParser.freeKit(o.kit)
}

func (o *OperationKit) Parse(ctx context.Context, clientInfo *ClientInfo) error {
	var (
		operationCount                  = 0
		anonymousOperationCount         = 0
		anonymousOperationDefinitionRef = -1
	)

	err := json.Unmarshal(o.data, &o.parsedOperation.Request)
	if err != nil {
		return &inputError{
			message:    fmt.Sprintf("error parsing request body: %s", err),
			statusCode: http.StatusBadRequest,
		}
	}

	if o.parsedOperation.Request.Extensions != nil {
		var mapExtensions map[string]any
		err = json.Unmarshal(o.parsedOperation.Request.Extensions, &mapExtensions)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing extensions: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		err = json.Unmarshal(o.parsedOperation.Request.Extensions, &o.parsedOperation.GraphQLRequestExtensions)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing extensions: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		if o.parsedOperation.GraphQLRequestExtensions.PersistedQuery != nil {
			// Delete persistedQuery from extensions to avoid it being passed to the subgraphs
			o.parsedOperation.Request.Extensions = jsonparser.Delete(o.parsedOperation.Request.Extensions, "persistedQuery")
		}
	}
	if o.parsedOperation.Request.Variables != nil {
		// variables must be a valid JSON object or null
		variables, err := fastjson.ParseBytes(o.parsedOperation.Request.Variables)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing variables: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		switch variables.Type() {
		case fastjson.TypeNull:
			// set variables to empty object if they are null, so we can later add exported defaults
			// also, other parts of the engine depend on variables being a valid JSON object
			o.parsedOperation.Request.Variables = []byte("{}")
			o.parsedOperation.Variables = fastjson.MustParseBytes(o.parsedOperation.Request.Variables).GetObject()
		case fastjson.TypeObject:
			o.parsedOperation.Variables = variables.GetObject()
		default:
			return &inputError{
				message:    "variables must be an object",
				statusCode: http.StatusBadRequest,
			}
		}
	} else {
		// set variables to empty object if they are null, so we can later add exported defaults
		// also, other parts of the engine depend on variables being a valid JSON object
		o.parsedOperation.Request.Variables = []byte("{}")
		o.parsedOperation.Variables = fastjson.MustParseBytes(o.parsedOperation.Request.Variables).GetObject()
	}

	// we're doing string matching on the operation name, so we override null with empty string
	if o.jsonIsNull(unsafebytes.StringToBytes(o.parsedOperation.Request.OperationName)) {
		o.parsedOperation.Request.OperationName = ""
	}

	if o.parsedOperation.GraphQLRequestExtensions.PersistedQuery != nil && len(o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash) > 0 {
		if o.operationParser.cdn == nil {
			return &inputError{
				message:    "could not resolve persisted query, feature is not configured",
				statusCode: http.StatusOK,
			}
		}
		o.parsedOperation.IsPersistedOperation = true
		fromCache, err := o.loadPersistedOperationFromCache()
		if err != nil {
			return &inputError{
				statusCode: http.StatusInternalServerError,
				message:    "error loading persisted operation from cache",
			}
		}
		if fromCache {
			return nil
		}
		persistedOperationData, err := o.operationParser.cdn.PersistedOperation(ctx, clientInfo.Name, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
		if err != nil {
			return err
		}
		// it's important to make a copy of the persisted operation data, because it's used in the cache
		// we might modify it later, so we don't want to modify the cached data
		o.parsedOperation.Request.Query = string(persistedOperationData)
	}

	if len(o.parsedOperation.Request.Query) == 0 {
		return &inputError{
			message:    "error parsing request body",
			statusCode: http.StatusBadRequest,
		}
	}

	report := &operationreport.Report{}
	o.kit.doc.Input.ResetInputString(o.parsedOperation.Request.Query)
	o.kit.parser.Parse(o.kit.doc, report)
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}

	for i := range o.kit.doc.RootNodes {
		if o.kit.doc.RootNodes[i].Kind != ast.NodeKindOperationDefinition {
			continue
		}
		operationCount++
		ref := o.kit.doc.RootNodes[i].Ref
		name := o.kit.doc.Input.ByteSliceString(o.kit.doc.OperationDefinitions[ref].Name)
		if len(name) == 0 {
			anonymousOperationCount++
			if anonymousOperationDefinitionRef == -1 {
				anonymousOperationDefinitionRef = ref
			}
			continue
		}
		if o.parsedOperation.Request.OperationName == "" {
			o.operationDefinitionRef = ref
			o.originalOperationNameRef = o.kit.doc.OperationDefinitions[ref].Name
			o.parsedOperation.Request.OperationName = name
			continue
		}
		if name == o.parsedOperation.Request.OperationName && o.operationDefinitionRef == -1 {
			o.operationDefinitionRef = ref
			o.originalOperationNameRef = o.kit.doc.OperationDefinitions[ref].Name
		}
	}

	if o.parsedOperation.Request.OperationName == "" && operationCount > 1 {
		return &inputError{
			message:    "operation name is required when multiple operations are defined",
			statusCode: http.StatusOK,
		}
	}

	if o.parsedOperation.Request.OperationName != "" && operationCount != 0 && o.operationDefinitionRef == -1 {
		return &inputError{
			message:    fmt.Sprintf("operation with name '%s' not found", o.parsedOperation.Request.OperationName),
			statusCode: http.StatusOK,
		}
	}

	if o.operationDefinitionRef == -1 {
		if anonymousOperationCount == 1 {
			o.operationDefinitionRef = anonymousOperationDefinitionRef
		} else if anonymousOperationCount > 1 {
			return &inputError{
				message:    "operation name is required when multiple operations are defined",
				statusCode: http.StatusOK,
			}
		} else {
			return &inputError{
				message:    fmt.Sprintf("operation with name '%s' not found", o.parsedOperation.Request.OperationName),
				statusCode: http.StatusOK,
			}
		}
	}

	switch o.kit.doc.OperationDefinitions[o.operationDefinitionRef].OperationType {
	case ast.OperationTypeQuery:
		o.parsedOperation.Type = "query"
	case ast.OperationTypeMutation:
		o.parsedOperation.Type = "mutation"
	case ast.OperationTypeSubscription:
		o.parsedOperation.Type = "subscription"
	default:
		return &inputError{
			message:    "operation type not supported",
			statusCode: http.StatusOK,
		}
	}

	// Replace the operation name with a static name to avoid different IDs for the same operation
	replaceOperationName := o.kit.doc.Input.AppendInputBytes(staticOperationName)
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = replaceOperationName
	return nil
}

// Normalize normalizes the operation. After normalization the normalized representation of the operation
// and variables is available. Also, the final operation ID is generated.
func (o *OperationKit) Normalize() (bool, error) {
	if o.parsedOperation.IsPersistedOperation {
		return o.normalizePersistedOperation()
	}
	return o.normalizeNonPersistedOperation()
}

func (o *OperationKit) normalizePersistedOperation() (cached bool, err error) {
	if o.parsedOperation.NormalizedRepresentation != "" {
		// normalized operation was loaded from cache
		return true, nil
	}
	skipIncludeNames := o.skipIncludeVariableNames()

	// we create a copy of the original variables because we need to delete variables that are not used in "skip" and "include" directives
	// skip or include directives have an influence on normalization (we're removing unused parts of the Operation)
	// so we want to extract those variables and set them as default values
	// later on, we can re-use the original variables again
	// the exported variables minus the variables that are used in skip or include directives are used for the exported defaults in the cache
	originalVariables := make([]byte, len(o.parsedOperation.Request.Variables))
	copy(originalVariables, o.parsedOperation.Request.Variables)

	o.parsedOperation.Variables.Visit(func(key []byte, v *fastjson.Value) {
		keyStr := unsafebytes.BytesToString(key)
		for i := range skipIncludeNames {
			if keyStr == skipIncludeNames[i] {
				return
			}
		}
		o.parsedOperation.Request.Variables = jsonparser.Delete(o.parsedOperation.Request.Variables, keyStr)
	})

	report := &operationreport.Report{}
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables
	o.kit.normalizer.NormalizeNamedOperation(o.kit.doc, o.operationParser.executor.ClientSchema, staticOperationName, report)
	if report.HasErrors() {
		return false, &reportError{
			report: report,
		}
	}

	exportedVariables := make([]byte, len(o.kit.doc.Input.Variables))
	copy(exportedVariables, o.kit.doc.Input.Variables)

	originalVariables, err = o.populateDefaultVariablesFromExportedDefaults(exportedVariables, originalVariables)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to set default values for variables: %w", err))
	}

	o.parsedOperation.Request.Variables = originalVariables

	// Hash the normalized operation with the static operation name to avoid different IDs for the same operation
	err = o.kit.printer.Print(o.kit.doc, o.operationParser.executor.ClientSchema, o.kit.keyGen)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Generate the operation ID
	o.parsedOperation.ID = o.kit.keyGen.Sum64()
	o.kit.keyGen.Reset()

	listVariableNames, listVariableNameWraps := o.extractListVariableNamesFromDoc()

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.operationParser.executor.ClientSchema, o.kit.normalizedOperation)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()
	err = o.coerceListVariables(listVariableNames, listVariableNameWraps)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to coerce list variables: %w", err))
	}

	if o.cache != nil && o.cache.persistedOperationCache != nil {
		o.savePersistedOperationToCache(skipIncludeNames, listVariableNames, listVariableNameWraps, exportedVariables)
	}

	return false, nil
}

type NormalizationCacheEntry struct {
	operationID              uint64
	normalizedRepresentation string
	operationType            string
	exportedVariables        []byte
	listVariableNames        []string
	listVariableNameWraps    []int
}

func (o *OperationKit) normalizeNonPersistedOperation() (cached bool, err error) {

	skipIncludeVariableNames := o.skipIncludeVariableNames()
	cacheKey := o.normalizationCacheKey(skipIncludeVariableNames)
	if o.cache != nil && o.cache.normalizationCache != nil {
		entry, ok := o.cache.normalizationCache.Get(cacheKey)
		if ok {
			o.parsedOperation.NormalizedRepresentation = entry.normalizedRepresentation
			o.parsedOperation.ID = entry.operationID
			o.parsedOperation.Type = entry.operationType
			o.parsedOperation.NormalizationCacheHit = true
			o.parsedOperation.Request.Variables, err = o.populateDefaultVariablesFromExportedDefaults(entry.exportedVariables, o.parsedOperation.Request.Variables)
			if err != nil {
				return false, errors.WithStack(fmt.Errorf("failed to set default values for variables: %w", err))
			}
			err = o.coerceListVariables(entry.listVariableNames, entry.listVariableNameWraps)
			if err != nil {
				return false, errors.WithStack(fmt.Errorf("failed to coerce list variables: %w", err))
			}
			return true, nil
		}
	}

	// we create a copy of the original variables because we need to delete variables that are not used in "skip" and "include" directives
	// skip or include directives have an influence on normalization (we're removing unused parts of the Operation)
	// so we want to extract those variables and set them as default values
	// later on, we can re-use the original variables again
	// the exported variables minus the variables that are used in skip or include directives are used for the exported defaults in the cache
	originalVariables := make([]byte, len(o.parsedOperation.Request.Variables))
	copy(originalVariables, o.parsedOperation.Request.Variables)

	// remove variables that are used in skip or include directives
	// these are just regular default values, so we can remove them
	// we only want to normalize the operation with variables that have an impact on the operation shape (skip or include directives)
	o.parsedOperation.Variables.Visit(func(key []byte, v *fastjson.Value) {
		keyStr := unsafebytes.BytesToString(key)
		for i := range skipIncludeVariableNames {
			if keyStr == skipIncludeVariableNames[i] {
				return
			}
		}
		o.parsedOperation.Request.Variables = jsonparser.Delete(o.parsedOperation.Request.Variables, keyStr)
	})

	// normalize the operation
	report := &operationreport.Report{}
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables
	o.kit.normalizer.NormalizeNamedOperation(o.kit.doc, o.operationParser.executor.ClientSchema, staticOperationName, report)
	if report.HasErrors() {
		return false, &reportError{
			report: report,
		}
	}

	// make a copy of the exported variables, so we can store them in the cache
	// for subsequent requests, they can be used to add missing variables
	exportedVariables := make([]byte, len(o.kit.doc.Input.Variables))
	copy(exportedVariables, o.kit.doc.Input.Variables)

	originalVariables, err = o.populateDefaultVariablesFromExportedDefaults(exportedVariables, originalVariables)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to set default values for variables: %w", err))
	}

	// reset with the original variables
	o.parsedOperation.Request.Variables = originalVariables
	o.kit.doc.Input.Variables = originalVariables

	// Hash the normalized operation with the static operation name & original variables to avoid different IDs for the same operation
	err = o.kit.printer.Print(o.kit.doc, o.operationParser.executor.ClientSchema, o.kit.keyGen)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Generate the operation ID
	o.parsedOperation.ID = o.kit.keyGen.Sum64()
	listVariableNames, listVariableNameWraps := o.extractListVariableNamesFromDoc()

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.operationParser.executor.ClientSchema, o.kit.normalizedOperation)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()
	err = o.coerceListVariables(listVariableNames, listVariableNameWraps)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to coerce list variables: %w", err))
	}

	if o.cache != nil && o.cache.normalizationCache != nil {
		entry := NormalizationCacheEntry{
			operationID:              o.parsedOperation.ID,
			normalizedRepresentation: o.parsedOperation.NormalizedRepresentation,
			operationType:            o.parsedOperation.Type,
			exportedVariables:        exportedVariables,
			listVariableNames:        listVariableNames,
			listVariableNameWraps:    listVariableNameWraps,
		}
		o.cache.normalizationCache.Set(cacheKey, entry, 1)
	}

	return false, nil
}

type normalizedOperationCacheEntry struct {
	operationID              uint64
	normalizedRepresentation string
	operationType            string
	exportedVariables        []byte
	listVariableNames        []string
	listVariableNameWraps    []int
}

func (o *OperationKit) loadPersistedOperationFromCache() (ok bool, err error) {

	if o.cache == nil || o.cache.persistedOperationCache == nil {
		return false, nil
	}

	cacheKey, ok := o.loadPersistedOperationCacheKey(o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
	if !ok {
		return false, nil
	}

	o.cache.persistedOperationCacheLock.RLock()
	entry, ok := o.cache.persistedOperationCache[cacheKey]
	o.cache.persistedOperationCacheLock.RUnlock()
	if !ok {
		return false, nil
	}
	o.parsedOperation.PersistedOperationCacheHit = true
	o.parsedOperation.ID = entry.operationID
	o.parsedOperation.NormalizedRepresentation = entry.normalizedRepresentation
	o.parsedOperation.Type = entry.operationType
	o.parsedOperation.Request.Variables, err = o.populateDefaultVariablesFromExportedDefaults(entry.exportedVariables, o.parsedOperation.Request.Variables)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to set default values for variables: %w", err))
	}
	err = o.coerceListVariables(entry.listVariableNames, entry.listVariableNameWraps)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("failed to coerce list variables: %w", err))
	}

	o.kit.doc.Input.ResetInputString(entry.normalizedRepresentation)
	report := &operationreport.Report{}
	o.kit.parser.Parse(o.kit.doc, report)
	if report.HasErrors() {
		return false, &reportError{
			report: report,
		}
	}

	return true, nil
}

// populateDefaultVariablesFromExportedDefaults iterates through the exported default variables and sets missing ones in the variables
func (o *OperationKit) populateDefaultVariablesFromExportedDefaults(exportedVariables, override []byte) ([]byte, error) {
	err := jsonparser.ObjectEach(exportedVariables, func(key []byte, value []byte, dataType jsonparser.ValueType, offset int) (err error) {
		if v := o.parsedOperation.Variables.Get(unsafebytes.BytesToString(key)); v != nil {
			return nil
		}
		if dataType == jsonparser.String {
			stringValue := make([]byte, len(value)+2)
			stringValue[0] = '"'
			copy(stringValue[1:], value)
			stringValue[len(stringValue)-1] = '"'
			override, err = jsonparser.Set(override, stringValue, unsafebytes.BytesToString(key))
		} else {
			override, err = jsonparser.Set(override, value, unsafebytes.BytesToString(key))
		}
		return
	})
	if err != nil {
		return nil, errors.WithStack(fmt.Errorf("failed to set default values for variables: %w", err))
	}
	return override, nil
}

func (o *OperationKit) jsonIsNull(variables []byte) bool {
	if variables == nil {
		return true
	}
	if len(variables) == 4 && unsafebytes.BytesToString(variables) == "null" {
		return true
	}
	value, err := fastjson.ParseBytes(variables)
	if err != nil {
		return false
	}
	return value.Type() == fastjson.TypeNull
}

func (o *OperationKit) savePersistedOperationToCache(skipIncludeVariableNames, listVariableNames []string, listVariableNameWraps []int, exportedVariables []byte) {
	cacheKey := o.generatePersistedOperationCacheKey(skipIncludeVariableNames)
	entry := normalizedOperationCacheEntry{
		operationID:              o.parsedOperation.ID,
		normalizedRepresentation: o.parsedOperation.NormalizedRepresentation,
		operationType:            o.parsedOperation.Type,
		exportedVariables:        make([]byte, len(exportedVariables)),
		listVariableNames:        listVariableNames,
		listVariableNameWraps:    listVariableNameWraps,
	}
	copy(entry.exportedVariables, exportedVariables)

	o.cache.persistedOperationCacheLock.Lock()
	o.cache.persistedOperationCache[cacheKey] = entry
	o.cache.persistedOperationCacheLock.Unlock()

	o.cache.persistetOperationVariableNamesLock.Lock()
	o.cache.persistetOperationVariableNames[o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash] = skipIncludeVariableNames
	o.cache.persistetOperationVariableNamesLock.Unlock()
}

func (o *OperationKit) loadPersistedOperationCacheKey(persistedQuerySha256Hash string) (key uint64, ok bool) {
	o.cache.persistetOperationVariableNamesLock.RLock()
	variableNames, ok := o.cache.persistetOperationVariableNames[persistedQuerySha256Hash]
	o.cache.persistetOperationVariableNamesLock.RUnlock()
	if !ok {
		return 0, false
	}
	key = o.generatePersistedOperationCacheKey(variableNames)
	return key, true
}

func (o *OperationKit) generatePersistedOperationCacheKey(skipIncludeVariableNames []string) uint64 {
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.Request.OperationName)
	o.writeSkipIncludeCacheKeyToKeyGen(skipIncludeVariableNames)
	sum := o.kit.keyGen.Sum64()
	o.kit.keyGen.Reset()
	return sum
}

func (o *OperationKit) normalizationCacheKey(skipIncludeVariableNames []string) uint64 {
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.Request.Query)
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.Request.OperationName)
	o.writeSkipIncludeCacheKeyToKeyGen(skipIncludeVariableNames)
	sum := o.kit.keyGen.Sum64()
	o.kit.keyGen.Reset()
	return sum
}

func (o *OperationKit) writeSkipIncludeCacheKeyToKeyGen(skipIncludeVariableNames []string) {
	for i := range skipIncludeVariableNames {
		value := o.parsedOperation.Variables.Get(skipIncludeVariableNames[i])
		if value == nil {
			_, _ = o.kit.keyGen.WriteString("f")
			continue
		}
		switch value.Type() {
		case fastjson.TypeTrue:
			_, _ = o.kit.keyGen.WriteString("t")
		case fastjson.TypeFalse:
			_, _ = o.kit.keyGen.WriteString("f")
		default:
			_, _ = o.kit.keyGen.WriteString("f")
		}
	}
}

// Validate validates the operation variables.
func (o *OperationKit) Validate() error {
	err := o.kit.variablesValidator.Validate(o.kit.doc, o.operationParser.executor.ClientSchema, o.parsedOperation.Request.Variables)
	if err != nil {
		return &inputError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}
	return nil
}

func (o *OperationKit) extractListVariableNamesFromDoc() ([]string, []int) {
	for i := range o.kit.doc.OperationDefinitions {
		nameRef := o.kit.doc.OperationDefinitions[i].Name
		name := o.kit.doc.Input.ByteSliceString(nameRef)
		if name != "O" {
			continue
		}
		refs := o.kit.doc.OperationDefinitions[i].VariableDefinitions.Refs
		listVariables := make([]string, 0, len(refs))
		listVariableDepth := make([]int, 0, len(refs))
		for j := range refs {
			isList := o.kit.doc.TypeIsList(o.kit.doc.VariableDefinitions[j].Type)
			if !isList {
				continue
			}
			listVariables = append(listVariables, o.kit.doc.VariableDefinitionNameString(j))
			listVariableDepth = append(listVariableDepth, o.kit.doc.TypeNumberOfListWraps(o.kit.doc.VariableDefinitions[j].Type))
		}
		return listVariables, listVariableDepth
	}
	return nil, nil
}

func (o *OperationKit) coerceListVariables(listVariableNames []string, listVariableNameWraps []int) (err error) {
	if len(listVariableNames) == 0 {
		return
	}
	o.parsedOperation.Variables.Visit(func(key []byte, v *fastjson.Value) {
		strKey := unsafebytes.BytesToString(key)
		i := slices.Index(listVariableNames, strKey)
		if i == -1 {
			return
		}
		switch v.Type() {
		case fastjson.TypeArray:
			return
		case fastjson.TypeNull:
			return
		default:
			wraps := listVariableNameWraps[i]
			arr := fastjson.MustParse(`[]`)
			arr.SetArrayItem(0, v)
			for j := 1; j < wraps; j++ {
				parent := fastjson.MustParse(`[]`)
				parent.SetArrayItem(0, arr)
				arr = parent
			}
			list := arr.MarshalTo(nil)
			o.parsedOperation.Request.Variables, err = jsonparser.Set(o.parsedOperation.Request.Variables, list, strKey)
			if err != nil {
				return
			}
		}
	})
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables
	return
}

var (
	literalIF = []byte("if")
)

func (o *OperationKit) skipIncludeVariableNames() []string {
	if len(o.kit.doc.Directives) == 0 {
		return nil
	}
	variableNames := make(map[string]struct{}, len(o.kit.doc.Directives))
	for i := range o.kit.doc.Directives {
		name := o.kit.doc.DirectiveNameBytes(i)
		switch string(name) {
		case "skip", "include":
			if value, ok := o.kit.doc.DirectiveArgumentValueByName(i, literalIF); ok {
				if value.Kind != ast.ValueKindVariable {
					continue
				}
				variableName := o.kit.doc.VariableValueNameString(value.Ref)
				variableNames[variableName] = struct{}{}
			}
		}
	}
	names := make([]string, len(variableNames))
	i := 0
	for name := range variableNames {
		names[i] = name
		i++
	}
	slices.Sort(names)
	return names
}

func NewOperationParser(opts OperationParserOptions) *OperationProcessor {
	processor := &OperationProcessor{
		executor:                opts.Executor,
		maxOperationSizeInBytes: opts.MaxOperationSizeInBytes,
		cdn:                     opts.PersistentOpClient,
		parseKitPool: &sync.Pool{
			New: func() interface{} {
				return &parseKit{
					parser: astparser.NewParser(),
					doc:    ast.NewSmallDocument(),
					keyGen: xxhash.New(),
					normalizer: astnormalization.NewWithOpts(
						astnormalization.WithExtractVariables(),
						astnormalization.WithInlineFragmentSpreads(),
						astnormalization.WithRemoveFragmentDefinitions(),
						astnormalization.WithRemoveNotMatchingOperationDefinitions(),
						astnormalization.WithRemoveUnusedVariables(),
					),
					printer:             &astprinter.Printer{},
					normalizedOperation: &bytes.Buffer{},
					variablesValidator:  variablesvalidation.NewVariablesValidator(),
				}
			},
		},
	}
	if opts.EnablePersistedOperationsCache {
		processor.operationCache = &OperationCache{
			persistetOperationVariableNames:     map[string][]string{},
			persistetOperationVariableNamesLock: &sync.RWMutex{},
			persistedOperationCache:             map[uint64]normalizedOperationCacheEntry{},
			persistedOperationCacheLock:         &sync.RWMutex{},
		}
	}
	if opts.NormalizationCache != nil {
		if processor.operationCache == nil {
			processor.operationCache = &OperationCache{}
		}
		processor.operationCache.normalizationCache = opts.NormalizationCache
	}
	return processor
}

func (p *OperationProcessor) getKit() *parseKit {
	return p.parseKitPool.Get().(*parseKit)
}

func (p *OperationProcessor) freeKit(kit *parseKit) {
	kit.keyGen.Reset()
	kit.doc.Reset()
	kit.normalizedOperation.Reset()
	p.parseKitPool.Put(kit)
}

func (p *OperationProcessor) entityTooLarge() error {
	return &inputError{
		message:    fmt.Sprintf("request body too large, max size is %d bytes", p.maxOperationSizeInBytes),
		statusCode: http.StatusRequestEntityTooLarge,
	}
}

func (p *OperationProcessor) ReadBody(buf *bytes.Buffer, r io.Reader) ([]byte, error) {
	if _, err := io.Copy(buf, r); err != nil {
		// Set when http.MaxBytesReader is used before
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return nil, p.entityTooLarge()
		}
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	return buf.Bytes(), nil
}

func (p *OperationProcessor) NewKitFromReader(r io.Reader) (*OperationKit, error) {
	buf := pool.GetBytesBuffer()
	defer pool.PutBytesBuffer(buf)
	data, err := p.ReadBody(buf, r)
	if err != nil {
		return nil, err
	}
	return NewOperationKit(p, data, nil), nil
}

// NewKit creates a new OperationKit. The kit is used to parse, normalize and
// validate operations. It also validates if the operation size is within the
// limit.
func (p *OperationProcessor) NewKit(data []byte, files []httpclient.File) (*OperationKit, error) {
	if len(data) > int(p.maxOperationSizeInBytes) {
		return nil, p.entityTooLarge()
	}
	return NewOperationKit(p, data, files), nil
}
