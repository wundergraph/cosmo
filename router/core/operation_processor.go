package core

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/dgraph-io/ristretto/v2"
	"github.com/pkg/errors"
	"github.com/tidwall/sjson"
	fastjson "github.com/wundergraph/astjson"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/apollocompatibility"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization/uploads"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/middleware/operation_complexity"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/variablesvalidation"

	"github.com/wundergraph/cosmo/router/internal/persistedoperation"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

var (
	// staticOperationName is used to replace the operation name in the document when generating the operation ID
	// this ensures that the operation ID is the same for the same operation regardless of the operation name
	staticOperationName = []byte("O")
)

type ParsedOperation struct {
	// ID represents a unique-ish ID for the operation calculated by hashing
	// its normalized representation
	ID uint64
	// InternalID is the internal ID of the operation calculated by hashing
	// its normalized representation with the original operation name and normalized variables
	InternalID uint64
	// Sha256Hash is the sha256 hash of the original operation query sent by the client
	Sha256Hash string
	// Type is a string representing the operation type. One of
	// "query", "mutation", "subscription"
	Type           string
	Variables      *fastjson.Object
	RemapVariables map[string]string
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

func (o *ParsedOperation) IDString() string {
	return strconv.FormatUint(o.ID, 10)
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

func (e invalidExtensionsTypeError) ExtensionCode() string {
	return ""
}

var (
	_ HttpError = invalidExtensionsTypeError(0)
)

type OperationProcessorOptions struct {
	Executor                            *Executor
	MaxOperationSizeInBytes             int64
	PersistedOperationClient            *persistedoperation.Client
	AutomaticPersistedOperationCacheTtl int

	EnablePersistedOperationsCache                   bool
	PersistedOpsNormalizationCache                   *ristretto.Cache[uint64, NormalizationCacheEntry]
	NormalizationCache                               *ristretto.Cache[uint64, NormalizationCacheEntry]
	QueryDepthCache                                  *ristretto.Cache[uint64, ComplexityCacheEntry]
	ValidationCache                                  *ristretto.Cache[uint64, bool]
	OperationHashCache                               *ristretto.Cache[uint64, string]
	ParseKitPoolSize                                 int
	IntrospectionEnabled                             bool
	ApolloCompatibilityFlags                         config.ApolloCompatibilityFlags
	ApolloRouterCompatibilityFlags                   config.ApolloRouterCompatibilityFlags
	DisableExposingVariablesContentOnValidationError bool
	ComplexityLimits                                 *config.ComplexityLimits
	ParserTokenizerLimits                            astparser.TokenizerLimits
	OperationNameLengthLimit                         int
}

// OperationProcessor provides shared resources to the parseKit and OperationKit.
// It should be only instantiated once and shared across requests
type OperationProcessor struct {
	executor                 *Executor
	maxOperationSizeInBytes  int64
	persistedOperationClient *persistedoperation.Client
	operationCache           *OperationCache
	parseKits                map[int]*parseKit
	parseKitSemaphore        chan int
	introspectionEnabled     bool
	parseKitOptions          *parseKitOptions
	complexityLimits         *config.ComplexityLimits
	parserTokenizerLimits    astparser.TokenizerLimits
	operationNameLengthLimit int
}

// parseKit is a helper struct to parse, normalize and validate operations
type parseKit struct {
	i                   int
	numOperations       int
	parser              *astparser.Parser
	doc                 *ast.Document
	keyGen              *xxhash.Digest
	sha256Hash          hash.Hash
	staticNormalizer    *astnormalization.OperationNormalizer
	variablesNormalizer *astnormalization.VariablesNormalizer
	variablesRemapper   *astnormalization.VariablesMapper
	printer             *astprinter.Printer
	normalizedOperation *bytes.Buffer
	variablesValidator  *variablesvalidation.VariablesValidator
	operationValidator  *astvalidation.OperationValidator
}

type OperationCache struct {
	persistedOperationVariableNames     map[string][]string
	persistedOperationVariableNamesLock *sync.RWMutex

	automaticPersistedOperationCacheTtl float64

	persistedOperationNormalizationCache *ristretto.Cache[uint64, NormalizationCacheEntry]
	normalizationCache                   *ristretto.Cache[uint64, NormalizationCacheEntry]
	complexityCache                      *ristretto.Cache[uint64, ComplexityCacheEntry]
	validationCache                      *ristretto.Cache[uint64, bool]
	operationHashCache                   *ristretto.Cache[uint64, string]
}

// OperationKit provides methods to parse, normalize and validate operations.
// After each step, the operation is available as a ParsedOperation.
// It must be created for each request and freed after the request is done.
type OperationKit struct {
	cache                    *OperationCache
	operationDefinitionRef   int
	originalOperationNameRef ast.ByteSliceReference
	operationProcessor       *OperationProcessor
	kit                      *parseKit
	parsedOperation          *ParsedOperation
	introspectionEnabled     bool
}

type GraphQLRequest struct {
	Query         string          `json:"query,omitempty"`
	OperationName string          `json:"operationName,omitempty"`
	Variables     json.RawMessage `json:"variables,omitempty"`
	Extensions    json.RawMessage `json:"extensions,omitempty"`
}

type GraphQLRequestExtensions struct {
	PersistedQuery *GraphQLRequestExtensionsPersistedQuery `json:"persistedQuery"`
}

type GraphQLRequestExtensionsPersistedQuery struct {
	Version    int    `json:"version"`
	Sha256Hash string `json:"sha256Hash"`
}

// isValidHash verifies if the Sha256Hash string is valid and well-formed.
func (pq *GraphQLRequestExtensionsPersistedQuery) isValidHash() bool {
	if len(pq.Sha256Hash) != 64 {
		return false
	}
	_, err := hex.DecodeString(pq.Sha256Hash)
	return err == nil
}

func (pq *GraphQLRequestExtensionsPersistedQuery) HasHash() bool {
	return pq != nil && len(pq.Sha256Hash) > 0
}

type complexityComparison struct {
	field        int
	cachedField  int
	errorMessage string
}

// NewOperationKit creates a new OperationKit. The kit is used to parse, normalize and validate operations.
// It allocates resources that need to be freed by calling OperationKit.Free()
func NewOperationKit(processor *OperationProcessor) *OperationKit {
	return &OperationKit{
		operationProcessor:     processor,
		kit:                    processor.getKit(),
		operationDefinitionRef: -1,
		cache:                  processor.operationCache,
		parsedOperation:        &ParsedOperation{},
		introspectionEnabled:   processor.introspectionEnabled,
	}
}

// NewIndependentOperationKit creates a new OperationKit that does not share resources with other kits.
func NewIndependentOperationKit(processor *OperationProcessor) *OperationKit {
	return &OperationKit{
		operationProcessor:     processor,
		kit:                    createParseKit(0, processor.parseKitOptions),
		operationDefinitionRef: -1,
		cache:                  processor.operationCache,
		parsedOperation:        &ParsedOperation{},
		introspectionEnabled:   processor.introspectionEnabled,
	}
}

// Free releases the resources used by the OperationKit
func (o *OperationKit) Free() {
	o.operationProcessor.freeKit(o.kit)
}

// UnmarshalOperationFromURL loads the operation from the URL and unmarshal it into the ParsedOperation
// It follows the GraphQL over HTTP specification for GET requests https://graphql.github.io/graphql-over-http/draft/#sec-GET
// We always compact the variables and extensions to ensure that we produce easy to parse JSON for the engine
func (o *OperationKit) UnmarshalOperationFromURL(url *url.URL) error {

	values := url.Query()

	query := values.Get("query")
	if query != "" {
		o.parsedOperation.Request.Query = values.Get("query")
	}

	operationName := values.Get("operationName")
	if operationName != "" {
		o.parsedOperation.Request.OperationName = operationName
	}

	variables := values.Get("variables")
	if variables != "" {
		o.parsedOperation.Request.Variables = []byte(variables)
		// Do sanity check early with json because later we parse variables with fastjson,
		// and fastjson produces verbose error messages.
		buf := bytes.NewBuffer(make([]byte, len(o.parsedOperation.Request.Variables))[:0])
		err := json.Compact(buf, o.parsedOperation.Request.Variables)
		if err != nil {
			return fmt.Errorf("error parsing variables: %w", err)
		}
	}

	extensions := values.Get("extensions")
	if extensions != "" {
		o.parsedOperation.Request.Extensions = []byte(extensions)
	}

	return o.unmarshalOperation()
}

// UnmarshalOperationFromBody loads the operation from the request body and unmarshal it into the ParsedOperation.
// This will load operationName, query, variables and extensions from the request body,
// but extension and variables will be unmarshalled as JSON.RawMessage.
// We always compact the variables and extensions to ensure that we produce easy to parse JSON for the engine
func (o *OperationKit) UnmarshalOperationFromBody(data []byte) error {
	buf := bytes.NewBuffer(make([]byte, len(data))[:0])
	err := json.Compact(buf, data)
	if err != nil {
		return err
	}
	err = json.Unmarshal(buf.Bytes(), &o.parsedOperation.Request)
	if err != nil {
		return err
	}

	return o.unmarshalOperation()
}

// unmarshalOperation unmarshal the extensions and variables from the request body into the ParsedOperation
// and does some pre-processing on the operation to ensure that the engine can handle it
func (o *OperationKit) unmarshalOperation() error {
	var err error

	// trimmedError removes details not relevant to a user
	trimmedError := func(err error) string {
		var ue *json.UnmarshalTypeError
		if errors.As(err, &ue) {
			return "json: cannot unmarshal " + ue.Value
		}
		return err.Error()
	}

	if o.parsedOperation.Request.Extensions != nil {
		err = json.Unmarshal(o.parsedOperation.Request.Extensions, &o.parsedOperation.GraphQLRequestExtensions)
		if err != nil {
			return &httpGraphqlError{
				message:    fmt.Sprintf("error parsing extensions: %s", trimmedError(err)),
				statusCode: http.StatusBadRequest,
			}
		}
		if o.parsedOperation.GraphQLRequestExtensions.PersistedQuery != nil {
			if !o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.isValidHash() {
				return &httpGraphqlError{
					message:    "persistedQuery does not have a valid sha256 hash",
					statusCode: http.StatusBadRequest,
				}
			}

			// Delete persistedQuery from extensions to avoid it being passed to the subgraphs
			o.parsedOperation.Request.Extensions, err = sjson.DeleteBytes(o.parsedOperation.Request.Extensions, "persistedQuery")
			if err != nil {
				return &httpGraphqlError{
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
			return &httpGraphqlError{
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
			return &httpGraphqlError{
				message:    "variables must be a JSON object",
				statusCode: http.StatusBadRequest,
			}
		}
	} else {
		// Set variables to an empty object if they are null, so we can add exported defaults later.
		// Also, other parts of the engine depend on variables being a valid JSON object.
		o.parsedOperation.Request.Variables = []byte("{}")
		o.parsedOperation.Variables = fastjson.MustParseBytes(o.parsedOperation.Request.Variables).GetObject()
	}

	// we're doing string matching on the operation name, so we override null with empty string
	if o.jsonIsNull(unsafebytes.StringToBytes(o.parsedOperation.Request.OperationName)) {
		o.parsedOperation.Request.OperationName = ""
	}

	if o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.HasHash() {
		o.parsedOperation.IsPersistedOperation = true
	}

	return nil
}

func (o *OperationKit) ComputeOperationSha256() error {
	// Calculate a fast hash of the operation query to save the
	// expensive compute on the same request. We can't use the operation id at this point
	// because the id is generated after normalization. We want to have the hash as soon as possible for
	// observability reasons
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.Request.Query)
	id := o.kit.keyGen.Sum64()
	o.kit.keyGen.Reset()

	if v, ok := o.cache.operationHashCache.Get(id); ok {
		o.parsedOperation.Sha256Hash = v
		return nil
	}

	_, err := o.kit.sha256Hash.Write(unsafebytes.StringToBytes(o.parsedOperation.Request.Query))
	defer o.kit.sha256Hash.Reset()
	if err != nil {
		return err
	}

	// we're using the hex representation of the sha256 hash
	sha256Hash := hex.EncodeToString(o.kit.sha256Hash.Sum(nil))
	o.cache.operationHashCache.Set(id, sha256Hash, 1)
	o.parsedOperation.Sha256Hash = sha256Hash

	return nil
}

// FetchPersistedOperation fetches the persisted operation from the cache or the client. If the operation is fetched from the cache it returns true.
// UnmarshalOperationFromBody or UnmarshalOperationFromURL must be called before calling this method.
func (o *OperationKit) FetchPersistedOperation(ctx context.Context, clientInfo *ClientInfo) (skipParse bool, isAPQ bool, err error) {
	if o.operationProcessor.persistedOperationClient == nil {
		return false, false, &httpGraphqlError{
			message:    "could not resolve persisted query, feature is not configured",
			statusCode: http.StatusOK,
		}
	}
	fromCache, includeOperationName, err := o.loadPersistedOperationFromCache(clientInfo.Name)
	if err != nil {
		return false, false, &httpGraphqlError{
			statusCode: http.StatusInternalServerError,
			message:    "error loading persisted operation from cache",
		}
	}
	if fromCache {
		if fromCacheHasTTL, _ := o.persistedOperationCacheKeyHasTtl(clientInfo.Name, includeOperationName); fromCacheHasTTL {
			// if it is an APQ request, we need to save it again to renew the TTL expiration
			if err = o.operationProcessor.persistedOperationClient.SaveOperation(ctx, clientInfo.Name, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash, o.parsedOperation.NormalizedRepresentation); err != nil {
				return false, false, err
			}
		}
		return true, false, nil
	}

	// If APQ is enabled and the query body is in the request, short-circuit
	if o.parsedOperation.Request.Query != "" && o.operationProcessor.persistedOperationClient.APQEnabled() {
		isAPQ = true

		// If the operation was fetched with APQ, save it again to renew the TTL
		err := o.operationProcessor.persistedOperationClient.SaveOperation(ctx, clientInfo.Name, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash, o.parsedOperation.Request.Query)
		if err != nil {
			return false, true, err
		}
	} else {
		var persistedOperationData []byte
		var err error

		persistedOperationData, isAPQ, err = o.operationProcessor.persistedOperationClient.PersistedOperation(ctx, clientInfo.Name, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
		if err != nil {
			return false, isAPQ, err
		}

		if isAPQ && persistedOperationData == nil && o.parsedOperation.Request.Query == "" {
			// If the client has APQ enabled, throw an error if the operation wasn't attached to the request
			return false, isAPQ, &persistedoperation.PersistentOperationNotFoundError{
				ClientName: clientInfo.Name,
				Sha256Hash: o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash,
			}
		}

		// it's important to make a copy of the persisted operation data, because it's used in the cache
		// we might modify it later, so we don't want to modify the cached data
		if persistedOperationData != nil {
			o.parsedOperation.Request.Query = string(persistedOperationData)
			// when we have successfully loaded the operation content from the storage,
			// but it was passed via body instead of hash, we need to mark operation as persisted
			// to populate persisted operation cache
			o.parsedOperation.IsPersistedOperation = true
		}

		// If the operation was fetched with APQ, save it again to renew the TTL
		if isAPQ {
			if err = o.operationProcessor.persistedOperationClient.SaveOperation(ctx, clientInfo.Name, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash, o.parsedOperation.Request.Query); err != nil {
				return false, true, err
			}
		}
	}

	return false, isAPQ, nil
}

const (
	schemaIntrospectionFieldName = "__schema"
	typeIntrospectionFieldName   = "__type"
)

func (o *OperationKit) isIntrospectionQuery() (result bool, err error) {
	var operationDefinitionRef = ast.InvalidRef
	var possibleOperationDefinitionRefs = make([]int, 0)

	for i := 0; i < len(o.kit.doc.RootNodes); i++ {
		if o.kit.doc.RootNodes[i].Kind == ast.NodeKindOperationDefinition {
			possibleOperationDefinitionRefs = append(possibleOperationDefinitionRefs, o.kit.doc.RootNodes[i].Ref)
		}
	}

	if len(possibleOperationDefinitionRefs) == 0 {
		return
	} else if len(possibleOperationDefinitionRefs) == 1 {
		operationDefinitionRef = possibleOperationDefinitionRefs[0]
	} else {
		for i := 0; i < len(possibleOperationDefinitionRefs); i++ {
			ref := possibleOperationDefinitionRefs[i]
			name := o.kit.doc.OperationDefinitionNameString(ref)

			if o.isOperationNameLengthLimitExceeded(name) {
				return false, &httpGraphqlError{
					message: fmt.Sprintf("operation name of length %d exceeds max length of %d",
						len(name), o.operationProcessor.operationNameLengthLimit),
					statusCode: http.StatusBadRequest,
				}
			}

			if o.parsedOperation.Request.OperationName == name {
				operationDefinitionRef = ref
				break
			}
		}
	}

	if operationDefinitionRef == ast.InvalidRef {
		return
	}

	operationDef := o.kit.doc.OperationDefinitions[operationDefinitionRef]
	if operationDef.OperationType != ast.OperationTypeQuery {
		return
	}
	if !operationDef.HasSelections {
		return
	}

	selectionSet := o.kit.doc.SelectionSets[operationDef.SelectionSet]
	if len(selectionSet.SelectionRefs) == 0 {
		return
	}

	for i := 0; i < len(selectionSet.SelectionRefs); i++ {
		selection := o.kit.doc.Selections[selectionSet.SelectionRefs[i]]
		if selection.Kind != ast.SelectionKindField {
			continue
		}

		fieldName := o.kit.doc.FieldNameUnsafeString(selection.Ref)
		switch fieldName {
		case schemaIntrospectionFieldName, typeIntrospectionFieldName:
			return true, nil
		}
	}

	return false, nil
}

func (o *OperationKit) isOperationNameLengthLimitExceeded(operationName string) bool {
	if o.operationProcessor.operationNameLengthLimit == 0 {
		return false
	}
	return len(operationName) > o.operationProcessor.operationNameLengthLimit
}

// Parse parses the operation, populates the document and set the operation type.
// UnmarshalOperationFromBody must be called before calling this method.
func (o *OperationKit) Parse() error {
	var (
		anonymousOperationCount         = 0
		anonymousOperationDefinitionRef = -1
	)

	if len(o.parsedOperation.Request.Query) == 0 {
		return &httpGraphqlError{
			message:    "empty request body",
			statusCode: http.StatusBadRequest,
		}
	}

	report := &operationreport.Report{}
	o.kit.doc.Input.ResetInputString(o.parsedOperation.Request.Query)
	if _, err := o.kit.parser.ParseWithLimits(o.operationProcessor.parserTokenizerLimits, o.kit.doc, report); err != nil {
		return &httpGraphqlError{
			message:    err.Error(),
			statusCode: http.StatusBadRequest,
		}
	}
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}

	if !o.introspectionEnabled {
		isIntrospection, err := o.isIntrospectionQuery()

		if err != nil {
			var httpGqlError *httpGraphqlError
			if errors.As(err, &httpGqlError) {
				return httpGqlError
			}

			return &httpGraphqlError{
				message:    "could not determine if operation was an introspection query",
				statusCode: http.StatusOK,
			}
		}

		if isIntrospection {
			return &httpGraphqlError{
				message:    "GraphQL introspection is disabled by Cosmo Router, but the query contained __schema or __type. To enable introspection, set introspection_enabled: true in the Router configuration",
				statusCode: http.StatusOK,
			}
		}
	}

	o.kit.numOperations = 0
	for i := range o.kit.doc.RootNodes {
		if o.kit.doc.RootNodes[i].Kind != ast.NodeKindOperationDefinition {
			continue
		}
		o.kit.numOperations++
		ref := o.kit.doc.RootNodes[i].Ref
		name := string(o.kit.doc.OperationDefinitionNameBytes(ref))

		if len(name) == 0 {
			anonymousOperationCount++
			if anonymousOperationDefinitionRef == -1 {
				anonymousOperationDefinitionRef = ref
			}
			continue
		}

		if o.isOperationNameLengthLimitExceeded(name) {
			return &httpGraphqlError{
				message: fmt.Sprintf("operation name of length %d exceeds max length of %d",
					len(name), o.operationProcessor.operationNameLengthLimit),
				statusCode: http.StatusBadRequest,
			}
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

	if o.parsedOperation.Request.OperationName == "" && o.kit.numOperations > 1 {
		return &httpGraphqlError{
			message:    "operation name is required when multiple operations are defined",
			statusCode: http.StatusOK,
		}
	}

	if o.parsedOperation.Request.OperationName != "" && o.kit.numOperations != 0 && o.operationDefinitionRef == -1 {
		return &httpGraphqlError{
			message:    fmt.Sprintf("operation with name '%s' not found", o.parsedOperation.Request.OperationName),
			statusCode: http.StatusOK,
		}
	}

	if o.operationDefinitionRef == -1 {
		if anonymousOperationCount == 1 {
			o.operationDefinitionRef = anonymousOperationDefinitionRef
		} else if anonymousOperationCount > 1 {
			return &httpGraphqlError{
				message:    "operation name is required when multiple operations are defined",
				statusCode: http.StatusOK,
			}
		} else {
			return &httpGraphqlError{
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
		return &httpGraphqlError{
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
func (o *OperationKit) NormalizeOperation(clientName string, isApq bool) (bool, error) {
	if o.parsedOperation.IsPersistedOperation {
		return o.normalizePersistedOperation(clientName, isApq)
	}
	return o.normalizeNonPersistedOperation()
}

func (o *OperationKit) normalizePersistedOperation(clientName string, isApq bool) (cached bool, err error) {
	if o.parsedOperation.NormalizedRepresentation != "" {
		// when dealing with APQ requests which have a TTL set, we need to renew the TTL
		if shouldRenew, skipIncludeNames := o.persistedOperationCacheKeyHasTtl(clientName, o.kit.numOperations > 1); shouldRenew {
			o.savePersistedOperationToCache(clientName, true, skipIncludeNames)
		}
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

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.kit.normalizedOperation)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizePersistedOperation failed printing operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()
	o.parsedOperation.Request.Variables = o.kit.doc.Input.Variables

	if o.cache != nil && o.cache.persistedOperationNormalizationCache != nil {
		o.savePersistedOperationToCache(clientName, isApq, skipIncludeNames)
	}

	return false, nil
}

type NormalizationCacheEntry struct {
	operationID              uint64
	normalizedRepresentation string
	operationType            string
	operationDefinitionRef   int
}

type ComplexityCacheEntry struct {
	Depth            int
	TotalFields      int
	RootFields       int
	RootFieldAliases int
}

func (o *OperationKit) normalizeNonPersistedOperation() (cached bool, err error) {

	skipIncludeVariableNames := o.skipIncludeVariableNames()
	cacheKey := o.normalizationCacheKey(skipIncludeVariableNames)
	if o.cache != nil && o.cache.normalizationCache != nil {
		entry, ok := o.cache.normalizationCache.Get(cacheKey)
		if ok {
			o.parsedOperation.NormalizedRepresentation = entry.normalizedRepresentation
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
	err = o.kit.printer.Print(o.kit.doc, o.kit.keyGen)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizeNonPersistedOperation (uncached) failed generating operation hash: %w", err))
	}

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.kit.normalizedOperation)
	if err != nil {
		return false, errors.WithStack(fmt.Errorf("normalizeNonPersistedOperation (uncached) failed printing operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()

	if o.cache != nil && o.cache.normalizationCache != nil {
		entry := NormalizationCacheEntry{
			operationID:              o.parsedOperation.InternalID,
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
	if _, err := o.kit.parser.ParseWithLimits(o.operationProcessor.parserTokenizerLimits, o.kit.doc, report); err != nil {
		return &httpGraphqlError{
			message:    err.Error(),
			statusCode: http.StatusBadRequest,
		}
	}
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}
	return nil
}

func (o *OperationKit) NormalizeVariables() ([]uploads.UploadPathMapping, error) {
	variablesBefore := make([]byte, len(o.kit.doc.Input.Variables))
	copy(variablesBefore, o.kit.doc.Input.Variables)

	operationRawBytesBefore := make([]byte, len(o.kit.doc.Input.RawBytes))
	copy(operationRawBytesBefore, o.kit.doc.Input.RawBytes)

	report := &operationreport.Report{}
	uploadsMapping := o.kit.variablesNormalizer.NormalizeOperation(o.kit.doc, o.operationProcessor.executor.ClientSchema, report)
	if report.HasErrors() {
		return nil, &reportError{
			report: report,
		}
	}

	// Assuming the user sends a multi-operation document
	// During normalization, we removed the unused operations from the document
	// This will always lead to operation definitions of a length of 1 even when multiple operations are sent
	if o.parsedOperation.NormalizationCacheHit {
		o.operationDefinitionRef = 0
	}

	// Print the operation without the operation name to get the pure normalized form
	// Afterward we can calculate the operation ID that is used as a stable identifier for analytics

	o.kit.normalizedOperation.Reset()
	// store the original name of the operation
	nameRef := o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name

	staticNameRef := o.kit.doc.Input.AppendInputBytes([]byte(""))
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = staticNameRef

	err := o.kit.printer.Print(o.kit.doc, o.kit.normalizedOperation)
	if err != nil {
		return nil, err
	}
	// Reset the doc with the original name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = nameRef

	o.kit.keyGen.Reset()
	_, err = o.kit.keyGen.Write(o.kit.normalizedOperation.Bytes())
	if err != nil {
		return nil, err
	}

	o.parsedOperation.ID = o.kit.keyGen.Sum64()

	// If the normalized form of the operation didn't change, we don't need to print it again
	if bytes.Equal(o.kit.doc.Input.Variables, variablesBefore) && bytes.Equal(o.kit.doc.Input.RawBytes, operationRawBytesBefore) {
		return uploadsMapping, nil
	}

	o.kit.normalizedOperation.Reset()

	err = o.kit.printer.Print(o.kit.doc, o.kit.normalizedOperation)
	if err != nil {
		return nil, err
	}

	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()
	o.parsedOperation.Request.Variables = o.kit.doc.Input.Variables

	return uploadsMapping, nil
}

func (o *OperationKit) RemapVariables(disabled bool) error {
	report := &operationreport.Report{}

	// even if the variables are disabled, we still need to execute rest of the method,
	// as it generates InternalID for the operation, which is used as planner cache key
	if !disabled {
		variablesMap := o.kit.variablesRemapper.NormalizeOperation(o.kit.doc, o.operationProcessor.executor.ClientSchema, report)
		if report.HasErrors() {
			return &reportError{
				report: report,
			}
		}
		o.parsedOperation.RemapVariables = variablesMap
	}

	// Print the operation without the operation name to get the pure normalized form
	// Afterward we can calculate the operation ID that is used as a stable identifier for analytics

	o.kit.normalizedOperation.Reset()
	// store the original name of the operation
	nameRef := o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name

	staticNameRef := o.kit.doc.Input.AppendInputBytes([]byte(""))
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = staticNameRef

	err := o.kit.printer.Print(o.kit.doc, o.kit.normalizedOperation)
	if err != nil {
		return errors.WithStack(fmt.Errorf("RemapVariables failed generating operation hash: %w", err))
	}
	// Reset the doc with the original name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = nameRef

	o.kit.keyGen.Reset()
	_, err = o.kit.keyGen.Write(o.kit.normalizedOperation.Bytes())
	if err != nil {
		return err
	}

	// Generate the operation ID
	o.parsedOperation.InternalID = o.kit.keyGen.Sum64()
	o.kit.keyGen.Reset()

	o.kit.normalizedOperation.Reset()
	err = o.kit.printer.Print(o.kit.doc, o.kit.normalizedOperation)
	if err != nil {
		return err
	}

	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()

	return nil
}

func (o *OperationKit) loadPersistedOperationFromCache(clientName string) (ok bool, includeOpName bool, err error) {

	if o.cache == nil || o.cache.persistedOperationNormalizationCache == nil {
		return false, false, nil
	}

	cacheKey, ok := o.loadPersistedOperationCacheKey(clientName, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash, false)
	if !ok {
		_, _ = o.cache.persistedOperationNormalizationCache.Get(0) // register cache miss
		return false, false, nil
	}

	entry, ok := o.cache.persistedOperationNormalizationCache.Get(cacheKey)
	if ok {
		return true, false, o.handleFoundPersistedOperationEntry(entry)
	}

	if o.parsedOperation.Request.OperationName == "" {
		return false, false, nil
	}

	if namedCacheKey, namedOk := o.loadPersistedOperationCacheKey(clientName, o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash, true); namedOk {
		if namedEntry, ok := o.cache.persistedOperationNormalizationCache.Get(namedCacheKey); ok {
			return true, true, o.handleFoundPersistedOperationEntry(namedEntry)
		}
	}

	return false, false, nil
}

func (o *OperationKit) handleFoundPersistedOperationEntry(entry NormalizationCacheEntry) error {
	o.parsedOperation.PersistedOperationCacheHit = true
	// we need to mark operation as persisted when it was called by query body
	// otherwise in case it was already cached we will try to normalize an empty document
	// as we skip parse for the cached persisted operations
	o.parsedOperation.IsPersistedOperation = true
	o.parsedOperation.NormalizationCacheHit = true
	o.parsedOperation.InternalID = entry.operationID
	o.parsedOperation.NormalizedRepresentation = entry.normalizedRepresentation
	o.parsedOperation.Type = entry.operationType
	//  We will always only have a single operation definition in the document
	// Because we removed the unused operations during normalization
	o.operationDefinitionRef = 0
	err := o.setAndParseOperationDoc()
	if err != nil {
		return err
	}
	return nil
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

func (o *OperationKit) persistedOperationCacheKeyHasTtl(clientName string, includeOperationName bool) (bool, []string) {
	if o.cache == nil || o.cache.persistedOperationVariableNames == nil || o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash == "" {
		return false, nil
	}

	o.cache.persistedOperationVariableNamesLock.RLock()
	variableNames, present := o.cache.persistedOperationVariableNames[o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash]
	o.cache.persistedOperationVariableNamesLock.RUnlock()
	if !present {
		return false, variableNames
	}
	cacheKey := o.generatePersistedOperationCacheKey(clientName, variableNames, includeOperationName)

	ttl, ok := o.cache.persistedOperationNormalizationCache.GetTTL(cacheKey)
	return ok && ttl > 0, variableNames
}

func (o *OperationKit) savePersistedOperationToCache(clientName string, isApq bool, skipIncludeVariableNames []string) {
	cacheKey := o.generatePersistedOperationCacheKey(clientName, skipIncludeVariableNames, o.kit.numOperations > 1)
	entry := NormalizationCacheEntry{
		operationID:              o.parsedOperation.InternalID,
		normalizedRepresentation: o.parsedOperation.NormalizedRepresentation,
		operationType:            o.parsedOperation.Type,
		operationDefinitionRef:   o.operationDefinitionRef,
	}

	if isApq {
		ttl := o.cache.automaticPersistedOperationCacheTtl
		ttlD := time.Duration(ttl) * time.Second
		o.cache.persistedOperationNormalizationCache.SetWithTTL(cacheKey, entry, 1, ttlD)
	} else {
		o.cache.persistedOperationNormalizationCache.Set(cacheKey, entry, 1)
	}

	o.cache.persistedOperationVariableNamesLock.Lock()
	o.cache.persistedOperationVariableNames[o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash] = skipIncludeVariableNames
	o.cache.persistedOperationVariableNamesLock.Unlock()
}

func (o *OperationKit) loadPersistedOperationCacheKey(clientName, persistedQuerySha256Hash string, includeOperationName bool) (key uint64, ok bool) {
	o.cache.persistedOperationVariableNamesLock.RLock()
	variableNames := o.cache.persistedOperationVariableNames[persistedQuerySha256Hash]
	o.cache.persistedOperationVariableNamesLock.RUnlock()
	key = o.generatePersistedOperationCacheKey(clientName, variableNames, includeOperationName)
	return key, true
}

func (o *OperationKit) generatePersistedOperationCacheKey(clientName string, skipIncludeVariableNames []string, includeOperationName bool) uint64 {
	_, _ = o.kit.keyGen.WriteString(o.parsedOperation.GraphQLRequestExtensions.PersistedQuery.Sha256Hash)
	if includeOperationName {
		// If there are multiple operations in the document, we need to include the operation name in the cache key
		_, _ = o.kit.keyGen.WriteString(o.parsedOperation.Request.OperationName)
	}
	_, _ = o.kit.keyGen.WriteString(clientName)
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
func (o *OperationKit) Validate(skipLoader bool, remapVariables map[string]string, apolloCompatibilityFlags *config.ApolloCompatibilityFlags) (cacheHit bool, err error) {
	if !skipLoader {
		// in case we're skipping the loader, it means that we won't execute the operation
		// this means that we don't need to validate the variables as they are not used
		// this is useful to return a query plan without having to provide variables
		err = o.kit.variablesValidator.ValidateWithRemap(o.kit.doc, o.operationProcessor.executor.ClientSchema, o.kit.doc.Input.Variables, remapVariables)
		if err != nil {
			var invalidVarErr *variablesvalidation.InvalidVariableError
			if errors.As(err, &invalidVarErr) {
				graphqlErr := &httpGraphqlError{
					extensionCode: invalidVarErr.ExtensionCode,
					message:       invalidVarErr.Error(),
					statusCode:    http.StatusOK,
				}
				if apolloCompatibilityFlags != nil && apolloCompatibilityFlags.ReplaceValidationErrorStatus.Enabled {
					graphqlErr.statusCode = http.StatusBadRequest
				}
				return false, graphqlErr
			}
			return false, &httpGraphqlError{
				message:    err.Error(),
				statusCode: http.StatusOK,
			}
		}
	}
	if o.cache != nil && o.cache.validationCache != nil {
		var valid bool
		valid, cacheHit = o.cache.validationCache.Get(o.parsedOperation.InternalID)
		if valid {
			return
		}
	}
	report := &operationreport.Report{}
	o.kit.operationValidator.Validate(o.kit.doc, o.operationProcessor.executor.ClientSchema, report)
	if o.cache != nil && o.cache.validationCache != nil {
		valid := !report.HasErrors()
		o.cache.validationCache.Set(o.parsedOperation.InternalID, valid, 1)
	}
	if report.HasErrors() {
		return cacheHit, &reportError{
			report: report,
		}
	}
	return
}

// ValidateQueryComplexity validates that the query complexity is within the limits set in the configuration
func (o *OperationKit) ValidateQueryComplexity() (ok bool, cacheEntry ComplexityCacheEntry, err error) {
	if o.operationProcessor.complexityLimits == nil {
		return true, ComplexityCacheEntry{}, nil
	}

	if o.cache != nil && o.cache.complexityCache != nil {
		if cachedComplexity, found := o.cache.complexityCache.Get(o.parsedOperation.InternalID); found {
			return true, cachedComplexity, o.runComplexityComparisons(o.operationProcessor.complexityLimits, cachedComplexity, o.parsedOperation.IsPersistedOperation)
		}
	}

	report := operationreport.Report{}
	globalComplexityResult, rootFieldStats := operation_complexity.CalculateOperationComplexity(o.kit.doc, o.operationProcessor.executor.ClientSchema, &report)
	cacheResult := ComplexityCacheEntry{
		Depth:       globalComplexityResult.Depth,
		TotalFields: globalComplexityResult.NodeCount,
	}
	for _, entry := range rootFieldStats {
		if entry.Alias == "" {
			cacheResult.RootFields += 1
		} else {
			cacheResult.RootFieldAliases += 1
		}
	}

	if o.cache != nil && o.cache.complexityCache != nil {
		o.cache.complexityCache.Set(o.parsedOperation.InternalID, cacheResult, 1)
	}

	return false, cacheResult, o.runComplexityComparisons(o.operationProcessor.complexityLimits, cacheResult, o.parsedOperation.IsPersistedOperation)
}

func (o *OperationKit) runComplexityComparisons(complexityLimitConfig *config.ComplexityLimits, cachedComplexity ComplexityCacheEntry, isPersisted bool) error {
	testComparisons := []complexityComparison{}
	if complexityLimitConfig.Depth != nil && complexityLimitConfig.Depth.ApplyLimit(isPersisted) {
		testComparisons = append(testComparisons,
			complexityComparison{complexityLimitConfig.Depth.Limit, cachedComplexity.Depth, fmt.Sprintf("The query depth %d exceeds the max query depth allowed (%d)", cachedComplexity.Depth, complexityLimitConfig.Depth.Limit)})
	}
	if complexityLimitConfig.TotalFields != nil && complexityLimitConfig.TotalFields.ApplyLimit(isPersisted) {
		testComparisons = append(testComparisons,
			complexityComparison{complexityLimitConfig.TotalFields.Limit, cachedComplexity.TotalFields, fmt.Sprintf("The total number of fields %d exceeds the limit allowed (%d)", cachedComplexity.TotalFields, complexityLimitConfig.TotalFields.Limit)})
	}
	if complexityLimitConfig.RootFields != nil && complexityLimitConfig.RootFields.ApplyLimit(isPersisted) {
		testComparisons = append(testComparisons,
			complexityComparison{complexityLimitConfig.RootFields.Limit, cachedComplexity.RootFields, fmt.Sprintf("The number of root fields %d exceeds the root field limit allowed (%d)", cachedComplexity.RootFields, complexityLimitConfig.RootFields.Limit)})
	}
	if complexityLimitConfig.RootFieldAliases != nil && complexityLimitConfig.RootFieldAliases.ApplyLimit(isPersisted) {
		testComparisons = append(testComparisons,
			complexityComparison{complexityLimitConfig.RootFieldAliases.Limit, cachedComplexity.RootFieldAliases, fmt.Sprintf("The number of root field aliases %d exceeds the root field aliases limit allowed (%d)", cachedComplexity.RootFieldAliases, complexityLimitConfig.RootFieldAliases.Limit)})
	}

	for _, comparison := range testComparisons {
		valid := comparison.field <= 0 || comparison.cachedField <= comparison.field
		if !valid {
			return &httpGraphqlError{
				message:    comparison.errorMessage,
				statusCode: http.StatusBadRequest,
			}
		}
	}

	return nil
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

type parseKitOptions struct {
	apolloCompatibilityFlags                         config.ApolloCompatibilityFlags
	apolloRouterCompatibilityFlags                   config.ApolloRouterCompatibilityFlags
	disableExposingVariablesContentOnValidationError bool
}

func createParseKit(i int, options *parseKitOptions) *parseKit {
	return &parseKit{
		i:          i,
		parser:     astparser.NewParser(),
		doc:        ast.NewSmallDocument(),
		keyGen:     xxhash.New(),
		sha256Hash: sha256.New(),
		staticNormalizer: astnormalization.NewWithOpts(
			astnormalization.WithRemoveNotMatchingOperationDefinitions(),
			astnormalization.WithInlineFragmentSpreads(),
			astnormalization.WithRemoveFragmentDefinitions(),
			astnormalization.WithRemoveUnusedVariables(),
		),
		variablesNormalizer: astnormalization.NewVariablesNormalizer(),
		variablesRemapper:   astnormalization.NewVariablesMapper(),
		printer:             &astprinter.Printer{},
		normalizedOperation: &bytes.Buffer{},
		variablesValidator: variablesvalidation.NewVariablesValidator(variablesvalidation.VariablesValidatorOptions{
			ApolloCompatibilityFlags: apollocompatibility.Flags{
				ReplaceInvalidVarError: options.apolloCompatibilityFlags.ReplaceInvalidVarErrors.Enabled,
			},
			ApolloRouterCompatibilityFlags: apollocompatibility.ApolloRouterFlags{
				ReplaceInvalidVarError: options.apolloRouterCompatibilityFlags.ReplaceInvalidVarErrors.Enabled,
			},
			DisableExposingVariablesContent: options.disableExposingVariablesContentOnValidationError,
		}),
		operationValidator: astvalidation.DefaultOperationValidator(astvalidation.WithApolloCompatibilityFlags(
			apollocompatibility.Flags{
				UseGraphQLValidationFailedStatus: options.apolloCompatibilityFlags.UseGraphQLValidationFailedStatus.Enabled,
			},
		)),
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
		introspectionEnabled:     opts.IntrospectionEnabled,
		parserTokenizerLimits:    opts.ParserTokenizerLimits,
		operationNameLengthLimit: opts.OperationNameLengthLimit,
		complexityLimits:         opts.ComplexityLimits,
		parseKitOptions: &parseKitOptions{
			apolloCompatibilityFlags:                         opts.ApolloCompatibilityFlags,
			apolloRouterCompatibilityFlags:                   opts.ApolloRouterCompatibilityFlags,
			disableExposingVariablesContentOnValidationError: opts.DisableExposingVariablesContentOnValidationError,
		},
	}
	for i := 0; i < opts.ParseKitPoolSize; i++ {
		processor.parseKitSemaphore <- i
		processor.parseKits[i] = createParseKit(i, processor.parseKitOptions)
	}
	if opts.NormalizationCache != nil || opts.ValidationCache != nil || opts.QueryDepthCache != nil || opts.OperationHashCache != nil || opts.EnablePersistedOperationsCache {
		processor.operationCache = &OperationCache{
			normalizationCache: opts.NormalizationCache,
			validationCache:    opts.ValidationCache,
			complexityCache:    opts.QueryDepthCache,
			operationHashCache: opts.OperationHashCache,
		}
	}
	if opts.EnablePersistedOperationsCache {
		processor.operationCache.automaticPersistedOperationCacheTtl = float64(opts.AutomaticPersistedOperationCacheTtl)
		processor.operationCache.persistedOperationVariableNames = map[string][]string{}
		processor.operationCache.persistedOperationVariableNamesLock = &sync.RWMutex{}
		processor.operationCache.persistedOperationNormalizationCache = opts.PersistedOpsNormalizationCache
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
	kit.sha256Hash.Reset()
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

func (p *OperationProcessor) ReadBody(reader io.Reader, buf *bytes.Buffer) ([]byte, error) {
	if _, err := io.Copy(buf, reader); err != nil {
		// Set when http.MaxBytesReader is used before
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return nil, &httpGraphqlError{
				message:    fmt.Sprintf("request body too large, max size is %d bytes", p.maxOperationSizeInBytes),
				statusCode: http.StatusRequestEntityTooLarge,
			}
		}
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	return buf.Bytes(), nil
}

// NewKit creates a new OperationKit. The kit is used to parse, normalize and
// validate operations. It also validates if the operation size is within the
// limit.
func (p *OperationProcessor) NewKit() (*OperationKit, error) {
	return NewOperationKit(p), nil
}

// NewIndependentKit creates a new OperationKit which will not be pooled.
// This is useful, e.g. for warming up the caches
func (p *OperationProcessor) NewIndependentKit() (*OperationKit, error) {
	return NewIndependentOperationKit(p), nil
}
