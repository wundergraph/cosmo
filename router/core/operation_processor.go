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
	"github.com/tidwall/sjson"
	"github.com/valyala/fastjson"
	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/variablesvalidation"
	"go.opentelemetry.io/otel/attribute"
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

type OperationProcessorOptions struct {
	Executor                 *Executor
	MaxOperationSizeInBytes  int64
	PersistedOperationClient persistedoperation.Client

	EnablePersistedOperationsCache bool
	NormalizationCache             *ristretto.Cache[uint64, NormalizationCacheEntry]
	ValidationCache                *ristretto.Cache[uint64, bool]
	ParseKitPoolSize               int
}

// OperationProcessor provides shared resources to the parseKit and OperationKit.
// It should be only instantiated once and shared across requests
type OperationProcessor struct {
	executor                 *Executor
	maxOperationSizeInBytes  int64
	persistedOperationClient persistedoperation.Client
	operationCache           *OperationCache
	parseKits                map[int]*parseKit
	parseKitSemaphore        chan int
}

// parseKit is a helper struct to parse, normalize and validate operations
type parseKit struct {
	i                   int
	parser              *astparser.Parser
	doc                 *ast.Document
	keyGen              *xxhash.Digest
	staticNormalizer    *astnormalization.OperationNormalizer
	variablesNormalizer *astnormalization.VariablesNormalizer
	printer             *astprinter.Printer
	normalizedOperation *bytes.Buffer
	variablesValidator  *variablesvalidation.VariablesValidator
	operationValidator  *astvalidation.OperationValidator
}

type OperationCache struct {
	persistetOperationVariableNames     map[string][]string
	persistetOperationVariableNamesLock *sync.RWMutex

	persistedOperationCache     map[uint64]normalizedOperationCacheEntry
	persistedOperationCacheLock *sync.RWMutex

	normalizationCache *ristretto.Cache[uint64, NormalizationCacheEntry]
	validationCache    *ristretto.Cache[uint64, bool]
}

// OperationKit provides methods to parse, normalize and validate operations.
// After each step, the operation is available as a ParsedOperation.
// It must be created for each request and freed after the request is done.
type OperationKit struct {
	cache                    *OperationCache
	data                     []byte
	operationDefinitionRef   int
	originalOperationNameRef ast.ByteSliceReference
	operationProcessor       *OperationProcessor
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
		operationProcessor:     processor,
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
	o.operationProcessor.freeKit(o.kit)
}

// UnmarshalOperation loads the operation from the request body and unmarshal it into the ParsedOperation
func (o *OperationKit) UnmarshalOperation() error {
	buf := bytes.NewBuffer(make([]byte, len(o.data))[:0])
	err := json.Compact(buf, o.data)
	if err != nil {
		return &inputError{
			message:    fmt.Sprintf("error parsing request body: %s", err),
			statusCode: http.StatusBadRequest,
		}
	}
	o.data = buf.Bytes()
	err = json.Unmarshal(o.data, &o.parsedOperation.Request)
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
			o.parsedOperation.Request.Extensions, err = sjson.DeleteBytes(o.parsedOperation.Request.Extensions, "persistedQuery")
			if err != nil {
				return &inputError{
					message:    fmt.Sprintf("error deleting persistedQuery from extensions: %s", err),
					statusCode: http.StatusBadRequest,
				}
			}
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
		o.parsedOperation.IsPersistedOperation = true
	}

	return nil
}

// FetchPersistedOperation fetches the persisted operation from the cache or the client. If the operation is fetched from the cache it returns true.
// UnmarshalOperation must be called before calling this method.
func (o *OperationKit) FetchPersistedOperation(ctx context.Context, clientInfo *ClientInfo, commonTraceAttributes []attribute.KeyValue) (bool, error) {
	if o.operationProcessor.persistedOperationClient == nil {
		return false, &inputError{
			message:    "could not resolve persisted query, feature is not configured",
			statusCode: http.StatusOK,
		}
	}
	fromCache, err := o.loadPersistedOperationFromCache()
	if err != nil {
		return false, &inputError{
			statusCode: http.StatusInternalServerError,
			message:    "error loading persisted operation from cache",
		}
	}
	if fromCache {
		return true, nil
	}
	persistedOperationData, err := o.operationProcessor.persistedOperationClient.PersistedOperation(ctx, clientInfo.Name, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash, commonTraceAttributes)
	if err != nil {
		return false, err
	}
	// it's important to make a copy of the persisted operation data, because it's used in the cache
	// we might modify it later, so we don't want to modify the cached data
	o.parsedOperation.Request.Query = string(persistedOperationData)

	return false, nil
}

// Parse parses the operation, populate the document and set the operation type.
// UnmarshalOperation must be called before calling this method.
func (o *OperationKit) Parse() error {
	var (
		operationCount                  = 0
		anonymousOperationCount         = 0
		anonymousOperationDefinitionRef = -1
	)

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

// NormalizeOperation normalizes the operation. After normalization the normalized representation of the operation
// and variables is available. Also, the final operation ID is generated.
func (o *OperationKit) NormalizeOperation() (bool, error) {
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

	report := &operationreport.Report{}
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables
	o.kit.staticNormalizer.NormalizeNamedOperation(o.kit.doc, o.operationProcessor.executor.ClientSchema, staticOperationName, report)
	if report.HasErrors() {
		return false, &reportError{
			report: report,
		}
	}

	// Hash the normalized operation with the static operation name to avoid different IDs for the same operation
	err = o.kit.printer.Print(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.keyGen)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizePersistedOperation failed generating operation hash: %w", err))
	}

	// Generate the operation ID
	o.parsedOperation.ID = o.kit.keyGen.Sum64()
	o.kit.keyGen.Reset()

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.normalizedOperation)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizePersistedOperation failed printing operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()
	o.parsedOperation.Request.Variables = o.kit.doc.Input.Variables

	if o.cache != nil && o.cache.persistedOperationCache != nil {
		o.savePersistedOperationToCache(skipIncludeNames)
	}

	return false, nil
}

type NormalizationCacheEntry struct {
	operationID              uint64
	normalizedRepresentation string
	operationType            string
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
			err = o.setAndParseOperationDoc()
			if err != nil {
				return false, err
			}
			return true, nil
		}
	}

	// normalize the operation
	report := &operationreport.Report{}
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables
	o.kit.staticNormalizer.NormalizeNamedOperation(o.kit.doc, o.operationProcessor.executor.ClientSchema, staticOperationName, report)
	if report.HasErrors() {
		return false, &reportError{
			report: report,
		}
	}

	// reset with the original variables
	o.parsedOperation.Request.Variables = o.kit.doc.Input.Variables

	// Hash the normalized operation with the static operation name & original variables to avoid different IDs for the same operation
	err = o.kit.printer.Print(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.keyGen)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizeNonPersistedOperation (uncached) failed generating operation hash: %w", err))
	}

	// Generate the operation ID
	o.parsedOperation.ID = o.kit.keyGen.Sum64()

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.normalizedOperation)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizeNonPersistedOperation (uncached) failed printing operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()

	if o.cache != nil && o.cache.normalizationCache != nil {
		entry := NormalizationCacheEntry{
			operationID:              o.parsedOperation.ID,
			normalizedRepresentation: o.parsedOperation.NormalizedRepresentation,
			operationType:            o.parsedOperation.Type,
		}
		o.cache.normalizationCache.Set(cacheKey, entry, 1)
	}

	return false, nil
}

func (o *OperationKit) setAndParseOperationDoc() error {
	o.kit.doc.Reset()
	o.kit.doc.Input.ResetInputString(o.parsedOperation.NormalizedRepresentation)
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables
	report := &operationreport.Report{}
	o.kit.parser.Parse(o.kit.doc, report)
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}
	return nil
}

func (o *OperationKit) NormalizeVariables() error {
	before := len(o.kit.doc.Input.Variables) + len(o.kit.doc.Input.RawBytes)
	report := &operationreport.Report{}
	o.kit.variablesNormalizer.NormalizeNamedOperation(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.parsedOperation.Request.OperationName, report)
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}
	after := len(o.kit.doc.Input.Variables) + len(o.kit.doc.Input.RawBytes)
	if after == before {
		return nil
	}
	o.kit.normalizedOperation.Reset()
	err := o.kit.printer.Print(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.normalizedOperation)
	if err != nil {
		return errors.WithStack(fmt.Errorf("normalizeVariables: %w", err))
	}
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()
	o.parsedOperation.Request.Variables = o.kit.doc.Input.Variables
	return nil
}

type normalizedOperationCacheEntry struct {
	operationID              uint64
	normalizedRepresentation string
	operationType            string
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
	err = o.setAndParseOperationDoc()
	if err != nil {
		return false, err
	}
	return true, nil
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

func (o *OperationKit) savePersistedOperationToCache(skipIncludeVariableNames []string) {
	cacheKey := o.generatePersistedOperationCacheKey(skipIncludeVariableNames)
	entry := normalizedOperationCacheEntry{
		operationID:              o.parsedOperation.ID,
		normalizedRepresentation: o.parsedOperation.NormalizedRepresentation,
		operationType:            o.parsedOperation.Type,
	}

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
			_, _ = o.kit.keyGen.WriteString("x")
			continue
		}
		switch value.Type() {
		case fastjson.TypeTrue:
			_, _ = o.kit.keyGen.WriteString("t")
		case fastjson.TypeFalse:
			_, _ = o.kit.keyGen.WriteString("f")
		default:
			_, _ = o.kit.keyGen.WriteString("x")
		}
	}
}

// Validate validates the operation variables.
func (o *OperationKit) Validate() (cacheHit bool, err error) {
	err = o.kit.variablesValidator.Validate(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.doc.Input.Variables)
	if err != nil {
		return false, &inputError{
			message:    err.Error(),
			statusCode: http.StatusOK,
		}
	}
	if o.cache != nil && o.cache.validationCache != nil {
		var valid bool
		valid, cacheHit = o.cache.validationCache.Get(o.parsedOperation.ID)
		if valid {
			return
		}
	}
	report := &operationreport.Report{}
	o.kit.operationValidator.Validate(o.kit.doc, o.operationProcessor.executor.ClientSchema, report)
	if o.cache != nil && o.cache.validationCache != nil {
		valid := !report.HasErrors()
		o.cache.validationCache.Set(o.parsedOperation.ID, valid, 1)
	}
	if report.HasErrors() {
		return cacheHit, &reportError{
			report: report,
		}
	}
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

func createParseKit(i int) *parseKit {
	return &parseKit{
		i:      i,
		parser: astparser.NewParser(),
		doc:    ast.NewSmallDocument(),
		keyGen: xxhash.New(),
		staticNormalizer: astnormalization.NewWithOpts(
			astnormalization.WithInlineFragmentSpreads(),
			astnormalization.WithRemoveFragmentDefinitions(),
			astnormalization.WithRemoveNotMatchingOperationDefinitions(),
			astnormalization.WithRemoveUnusedVariables(),
		),
		variablesNormalizer: astnormalization.NewVariablesNormalizer(),
		printer:             &astprinter.Printer{},
		normalizedOperation: &bytes.Buffer{},
		variablesValidator:  variablesvalidation.NewVariablesValidator(),
		operationValidator:  astvalidation.DefaultOperationValidator(),
	}
}

func NewOperationProcessor(opts OperationProcessorOptions) *OperationProcessor {
	if opts.ParseKitPoolSize <= 0 {
		opts.ParseKitPoolSize = 1
	}
	processor := &OperationProcessor{
		executor:                 opts.Executor,
		maxOperationSizeInBytes:  opts.MaxOperationSizeInBytes,
		persistedOperationClient: opts.PersistedOperationClient,
		parseKits:                make(map[int]*parseKit, opts.ParseKitPoolSize),
		parseKitSemaphore:        make(chan int, opts.ParseKitPoolSize),
	}
	for i := 0; i < opts.ParseKitPoolSize; i++ {
		processor.parseKitSemaphore <- i
		processor.parseKits[i] = createParseKit(i)
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
	if opts.ValidationCache != nil {
		if processor.operationCache == nil {
			processor.operationCache = &OperationCache{}
		}
		processor.operationCache.validationCache = opts.ValidationCache
	}
	return processor
}

func (p *OperationProcessor) getKit() *parseKit {
	i := <-p.parseKitSemaphore
	return p.parseKits[i]
}

func (p *OperationProcessor) freeKit(kit *parseKit) {
	kit.keyGen.Reset()
	kit.doc.Reset()
	kit.normalizedOperation.Reset()
	// because we're re-using the kit, and we're having a static number of kits based on the number of CPUs
	// we're resetting the doc, parser, and buffer for the normalized operation if they grow too large (>1MB of query size)
	if cap(kit.doc.Input.RawBytes) > 1024*1024 {
		kit.doc = ast.NewSmallDocument()
		kit.parser = astparser.NewParser()
		kit.normalizedOperation = &bytes.Buffer{}
	}
	p.parseKitSemaphore <- kit.i
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
