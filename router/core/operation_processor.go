package core

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/goccy/go-json"
	"github.com/pkg/errors"
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
	Type         string
	VariablesMap map[string]any
	// Files is a list of files, an interface representing the file data needed to be passed forward.
	Files []httpclient.File
	// NormalizedRepresentation is the normalized representation of the operation
	// as a string. This is provided for modules to be able to access the
	// operation. Only available after the operation has been normalized.
	NormalizedRepresentation string
	Request                  GraphQLRequest
	GraphQLRequestExtensions GraphQLRequestExtensions
	IsPersistedQuery         bool
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
	PersistentOpClient      *cdn.PersistentOperationClient
}

// OperationProcessor provides shared resources to the parseKit and OperationKit.
// It should be only instantiated once and shared across requests
type OperationProcessor struct {
	executor                *Executor
	maxOperationSizeInBytes int64
	cdn                     *cdn.PersistentOperationClient
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
	persistetOperationVariableNamesLock sync.RWMutex

	persistedOperationCache     map[uint64]normalizedOperationCacheEntry
	persistedOperationCacheLock sync.RWMutex
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
		err = json.Unmarshal(o.parsedOperation.Request.Variables, &o.parsedOperation.VariablesMap)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing variables: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
	}

	if o.parsedOperation.Request.OperationName == "null" {
		o.parsedOperation.Request.OperationName = ""
	}

	if o.parsedOperation.GraphQLRequestExtensions.PersistedQuery != nil && len(o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash) > 0 {
		if o.operationParser.cdn == nil {
			return &inputError{
				message:    "could not resolve persisted query, feature is not configured",
				statusCode: http.StatusOK,
			}
		}
		o.parsedOperation.IsPersistedQuery = true
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

	// set variables to empty object if they are null or not present
	if o.parsedOperation.Request.Variables == nil || bytes.Equal(o.parsedOperation.Request.Variables, []byte("null")) {
		o.parsedOperation.Request.Variables = []byte("{}")
	}

	// Set variables on doc input before normalization
	// IMPORTANT: this is required for the normalization to work correctly!
	// Normalization reads/rewrites/adds variables
	o.kit.doc.Input.Variables = o.parsedOperation.Request.Variables

	// Replace the operation name with a static name to avoid different IDs for the same operation
	replaceOperationName := o.kit.doc.Input.AppendInputBytes(staticOperationName)
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = replaceOperationName
	return nil
}

// Normalize normalizes the operation. After normalization the normalized representation of the operation
// and variables is available. Also, the final operation ID is generated.
func (o *OperationKit) Normalize() error {

	if o.parsedOperation.NormalizedRepresentation != "" {
		// normalized operation was loaded from cache
		return nil
	}

	skipIncludeNames := o.skipIncludeVariableNames()

	report := &operationreport.Report{}
	o.kit.normalizer.NormalizeNamedOperation(o.kit.doc, o.operationParser.executor.ClientSchema, staticOperationName, report)
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}

	// Hash the normalized operation with the static operation name to avoid different IDs for the same operation
	err := o.kit.printer.Print(o.kit.doc, o.operationParser.executor.ClientSchema, o.kit.keyGen)
	if err != nil {
		return errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Generate the operation ID
	o.parsedOperation.ID = o.kit.keyGen.Sum64()

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.operationParser.executor.ClientSchema, o.kit.normalizedOperation)
	if err != nil {
		return errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()

	// Here we copy the normalized variables. After normalization, the variables can be consumed or modified.
	variablesCopy := make([]byte, len(o.kit.doc.Input.Variables))
	copy(variablesCopy, o.kit.doc.Input.Variables)
	o.parsedOperation.Request.Variables = variablesCopy

	if o.parsedOperation.IsPersistedQuery {
		o.savePersistedOperationToCache(skipIncludeNames)
	}

	return nil
}

type normalizedOperationCacheEntry struct {
	operationID              uint64
	normalizedRepresentation string
	operationType            string
}

func (o *OperationKit) loadPersistedOperationFromCache() (ok bool, err error) {
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
	o.parsedOperation.ID = entry.operationID
	o.parsedOperation.NormalizedRepresentation = entry.normalizedRepresentation
	o.parsedOperation.Type = entry.operationType

	return true, nil
}

func (o *OperationKit) savePersistedOperationToCache(skipIncludeVariableNames []string) {
	cacheKey := o.generatePersistedOperationCacheKey(skipIncludeVariableNames)
	o.cache.persistedOperationCacheLock.Lock()
	o.cache.persistedOperationCache[cacheKey] = normalizedOperationCacheEntry{
		operationID:              o.parsedOperation.ID,
		normalizedRepresentation: o.parsedOperation.NormalizedRepresentation,
		operationType:            o.parsedOperation.Type,
	}
	o.cache.persistedOperationCacheLock.Unlock()
}

var (
	literalF = []byte("f")
	literalT = []byte("t")
)

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
	o.kit.keyGen.Reset()
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.Request.OperationName)
	for i := range skipIncludeVariableNames {
		value, exists := o.parsedOperation.VariablesMap[skipIncludeVariableNames[i]]
		if !exists {
			_, _ = o.kit.keyGen.Write(literalF)
			continue
		}
		switch v := value.(type) {
		case bool:
			if v {
				_, _ = o.kit.keyGen.Write(literalT)
			} else {
				_, _ = o.kit.keyGen.Write(literalF)
			}
		default:
			_, _ = o.kit.keyGen.Write(literalF)
		}
	}
	return o.kit.keyGen.Sum64()
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

var (
	literalIF = []byte("if")
)

func (o *OperationKit) skipIncludeVariableNames() []string {
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
	return names
}

func NewOperationParser(opts OperationParserOptions) *OperationProcessor {
	return &OperationProcessor{
		executor:                opts.Executor,
		maxOperationSizeInBytes: opts.MaxOperationSizeInBytes,
		cdn:                     opts.PersistentOpClient,
		operationCache: &OperationCache{
			persistetOperationVariableNames:     map[string][]string{},
			persistetOperationVariableNamesLock: sync.RWMutex{},
			persistedOperationCache:             map[uint64]normalizedOperationCacheEntry{},
			persistedOperationCacheLock:         sync.RWMutex{},
		},
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
}

func (p *OperationProcessor) getKit() *parseKit {
	return p.parseKitPool.Get().(*parseKit)
}

func (p *OperationProcessor) freeKit(kit *parseKit) {
	kit.keyGen.Reset()
	kit.doc.Reset()
	kit.normalizedOperation.Reset()
}

func (p *OperationProcessor) entityTooLarge() error {
	return &inputError{
		message:    "request body too large",
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
