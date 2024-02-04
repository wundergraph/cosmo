package core

import (
	"bytes"
	"context"
	"fmt"
	"hash"
	"io"
	"net/http"
	"sync"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/pkg/errors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/lexer/literal"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/variablesvalidation"

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
)

var (
	// staticOperationName is used to replace the operation name in the document when generating the operation ID
	// this ensures that the operation ID is the same for the same operation regardless of the operation name
	staticOperationName = []byte("O")
	parseOperationKeys  = [][]string{
		{"query"},
		{"variables"},
		{"operationName"},
		{"extensions"},
	}

	persistedQueryKeys = [][]string{
		{"version"},
		{"sha256Hash"},
	}
)

const (
	parseOperationKeysQueryIndex = iota
	parseOperationKeysVariablesIndex
	parseOperationKeysOperationNameIndex
	parseOperationKeysExtensionsIndex
)

const (
	persistedQueryKeysVersionIndex = iota
	persistedQueryKeysSha256HashIndex
)

type ParsedOperation struct {
	// ID represents a unique-ish ID for the operation calculated by hashing
	// its normalized representation and its variables
	ID uint64
	// Name is the operation name, if any
	Name string
	// Type is a string representing the operation type. One of
	// "query", "mutation", "subscription"
	Type string
	// Variables in the "variables" field value in the JSON payload
	Variables []byte
	// NormalizedRepresentation is the normalized representation of the operation
	// as a string. This is provided for modules to be able to access the
	// operation. Only available after the operation has been normalized.
	NormalizedRepresentation string
	Extensions               []byte
	PersistedID              string
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

// OperationParser provides shared resources to the parseKit and OperationKit.
// It should be only instantiated once and shared across requests
type OperationParser struct {
	executor                *Executor
	maxOperationSizeInBytes int64
	cdn                     *cdn.PersistentOperationClient
	parseKitPool            *sync.Pool
}

// parseKit is a helper struct to parse, normalize and validate operations
type parseKit struct {
	parser              *astparser.Parser
	doc                 *ast.Document
	keyGen              hash.Hash64
	normalizer          *astnormalization.OperationNormalizer
	printer             *astprinter.Printer
	normalizedOperation *bytes.Buffer
	unescapedDocument   []byte
	variablesValidator  *variablesvalidation.VariablesValidator
}

// OperationKit represent the result of parsing, normalizing and validating an operation.
// It must be created for each request and freed after the request is done.
type OperationKit struct {
	data                     []byte
	operationDefinitionRef   int
	originalOperationNameRef ast.ByteSliceReference
	operationParser          *OperationParser
	kit                      *parseKit
	parsedOperation          *ParsedOperation
}

// NewOperationKit creates a new OperationKit. The kit is used to parse, normalize and validate operations.
// It allocates resources that need to be freed by calling OperationKit.Free()
func NewOperationKit(parser *OperationParser, data []byte) *OperationKit {
	return &OperationKit{
		operationParser:        parser,
		kit:                    parser.getKit(),
		operationDefinitionRef: -1,
		data:                   data,
	}
}

// Free releases the resources used by the OperationKit
func (o *OperationKit) Free() {
	o.operationParser.freeKit(o.kit)
}

func (o *OperationKit) Parse(ctx context.Context, clientInfo *ClientInfo, log *zap.Logger) error {
	var (
		requestOperationType            string
		requestOperationNameBytes       []byte
		requestExtensions               []byte
		operationCount                  = 0
		anonymousOperationCount         = 0
		anonymousOperationDefinitionRef = -1
		requestDocumentBytes            []byte
		requestVariableBytes            []byte
		persistedQueryVersion           []byte
		persistedQuerySha256Hash        []byte
		parseErr                        error
		variablesValueType              jsonparser.ValueType
	)

	jsonparser.EachKey(o.data, func(i int, value []byte, valueType jsonparser.ValueType, err error) {
		if parseErr != nil {
			// If we already have an error, don't overwrite it
			return
		}
		if err != nil {
			parseErr = err
			return
		}
		switch i {
		case parseOperationKeysQueryIndex:
			requestDocumentBytes, err = jsonparser.Unescape(value, o.kit.unescapedDocument)
			if err != nil {
				parseErr = fmt.Errorf("error unescaping query: %w", err)
				return
			}
		case parseOperationKeysVariablesIndex:
			variablesValueType = valueType
			requestVariableBytes = value
		case parseOperationKeysOperationNameIndex:
			requestOperationNameBytes = value
		case parseOperationKeysExtensionsIndex:
			if valueType != jsonparser.Null && valueType != jsonparser.Object {
				parseErr = invalidExtensionsTypeError(valueType)
				return
			}
			requestExtensions = value
			persistedQuery, _, _, err := jsonparser.Get(value, "persistedQuery")
			if err != nil {
				return
			}
			if len(persistedQuery) > 0 {
				jsonparser.EachKey(persistedQuery, func(i int, value []byte, valueType jsonparser.ValueType, err error) {
					if err != nil {
						parseErr = err
						return
					}
					switch i {
					case persistedQueryKeysVersionIndex:
						persistedQueryVersion = value
					case persistedQueryKeysSha256HashIndex:
						persistedQuerySha256Hash = value
					}
				}, persistedQueryKeys...)
				if persistedQueryVersion == nil {
					log.Warn("persistedQuery.version is missing")
					persistedQuerySha256Hash = nil
					return
				}
				if len(persistedQueryVersion) != 1 || persistedQueryVersion[0] != '1' {
					log.Warn("unsupported persistedQuery.version", zap.String("version", string(persistedQueryVersion)))
					persistedQuerySha256Hash = nil
					return
				}
			}
		}
	}, parseOperationKeys...)

	switch variablesValueType {
	case jsonparser.Null, jsonparser.Unknown, jsonparser.Object, jsonparser.NotExist:
	// valid, continue
	case jsonparser.Array:
		return &inputError{
			message:    "variables value must not be an array",
			statusCode: http.StatusBadRequest,
		}
	case jsonparser.String:
		return &inputError{
			message:    "variables value must not be a string",
			statusCode: http.StatusBadRequest,
		}
	case jsonparser.Number:
		return &inputError{
			message:    "variables value must not be a number",
			statusCode: http.StatusBadRequest,
		}
	case jsonparser.Boolean:
		return &inputError{
			message:    "variables value must not be a boolean",
			statusCode: http.StatusBadRequest,
		}
	default:
		return &inputError{
			message:    "variables value must be a JSON object",
			statusCode: http.StatusBadRequest,
		}
	}

	if parseErr != nil {
		return errors.WithStack(parseErr)
	}

	if len(persistedQuerySha256Hash) > 0 {
		if o.operationParser.cdn == nil {
			return &inputError{
				message:    "could not resolve persisted query, feature is not configured",
				statusCode: http.StatusOK,
			}
		}
		persistedOperationData, err := o.operationParser.cdn.PersistedOperation(ctx, clientInfo.Name, persistedQuerySha256Hash)
		if err != nil {
			return errors.WithStack(err)
		}
		requestDocumentBytes = persistedOperationData
	}

	requestHasOperationName := requestOperationNameBytes != nil && !bytes.Equal(requestOperationNameBytes, literal.NULL)
	if !requestHasOperationName {
		requestOperationNameBytes = nil
	}

	report := &operationreport.Report{}
	o.kit.doc.Input.ResetInputBytes(requestDocumentBytes)
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
		name := o.kit.doc.Input.ByteSlice(o.kit.doc.OperationDefinitions[ref].Name)
		if len(name) == 0 {
			anonymousOperationCount++
			if anonymousOperationDefinitionRef == -1 {
				anonymousOperationDefinitionRef = ref
			}
			continue
		}
		if requestOperationNameBytes == nil {
			o.operationDefinitionRef = ref
			o.originalOperationNameRef = o.kit.doc.OperationDefinitions[ref].Name
			requestOperationNameBytes = name
			continue
		}
		if bytes.Equal(name, requestOperationNameBytes) && o.operationDefinitionRef == -1 {
			o.operationDefinitionRef = ref
			o.originalOperationNameRef = o.kit.doc.OperationDefinitions[ref].Name
		}
	}

	if !requestHasOperationName && operationCount > 1 {
		return &inputError{
			message:    "operation name is required when multiple operations are defined",
			statusCode: http.StatusOK,
		}
	}

	if requestHasOperationName && operationCount != 0 && o.operationDefinitionRef == -1 {
		return &inputError{
			message:    fmt.Sprintf("operation with name '%s' not found", string(requestOperationNameBytes)),
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
				message:    fmt.Sprintf("operation with name '%s' not found", string(requestOperationNameBytes)),
				statusCode: http.StatusOK,
			}
		}
	}

	switch o.kit.doc.OperationDefinitions[o.operationDefinitionRef].OperationType {
	case ast.OperationTypeQuery:
		requestOperationType = "query"
	case ast.OperationTypeMutation:
		requestOperationType = "mutation"
	case ast.OperationTypeSubscription:
		requestOperationType = "subscription"
	default:
		return &inputError{
			message:    "operation type not supported",
			statusCode: http.StatusBadRequest,
		}
	}

	// set variables to empty object if they are null or not present
	if requestVariableBytes == nil || bytes.Equal(requestVariableBytes, []byte("null")) {
		requestVariableBytes = []byte("{}")
	}

	// Set variables on doc input before normalization
	// IMPORTANT: this is required for the normalization to work correctly!
	// Normalization reads/rewrites/adds variables
	o.kit.doc.Input.Variables = requestVariableBytes

	// Replace the operation name with a static name to avoid different IDs for the same operation
	replaceOperationName := o.kit.doc.Input.AppendInputBytes(staticOperationName)
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = replaceOperationName

	// Here we create a copy of the original variables. After parse, the variables can be consumed or modified.
	variablesCopy := make([]byte, len(o.kit.doc.Input.Variables))
	copy(variablesCopy, o.kit.doc.Input.Variables)

	o.parsedOperation = &ParsedOperation{
		ID:                       0,  // will be set after normalization
		NormalizedRepresentation: "", // will be set after normalization
		Name:                     string(requestOperationNameBytes),
		Type:                     requestOperationType,
		Extensions:               requestExtensions,
		PersistedID:              string(persistedQuerySha256Hash),
		Variables:                variablesCopy,
	}

	return nil
}

// Normalize normalizes the operation. After normalization the normalized representation of the operation
// and variables is available. Also, the final operation ID is generated.
func (o *OperationKit) Normalize() error {
	report := &operationreport.Report{}
	o.kit.normalizer.NormalizeNamedOperation(o.kit.doc, o.operationParser.executor.Definition, staticOperationName, report)
	if report.HasErrors() {
		return &reportError{
			report: report,
		}
	}

	// Hash the normalized operation with the static operation name to avoid different IDs for the same operation
	err := o.kit.printer.Print(o.kit.doc, o.operationParser.executor.Definition, o.kit.keyGen)
	if err != nil {
		return errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Generate the operation ID
	o.parsedOperation.ID = o.kit.keyGen.Sum64()

	// Print the operation with the original operation name
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = o.originalOperationNameRef
	err = o.kit.printer.Print(o.kit.doc, o.operationParser.executor.Definition, o.kit.normalizedOperation)
	if err != nil {
		return errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	// Set the normalized representation
	o.parsedOperation.NormalizedRepresentation = o.kit.normalizedOperation.String()

	// Here we copy the normalized variables. After normalization, the variables can be consumed or modified.
	variablesCopy := make([]byte, len(o.kit.doc.Input.Variables))
	copy(variablesCopy, o.kit.doc.Input.Variables)

	o.parsedOperation.Variables = variablesCopy

	return nil
}

// Validate validates the operation variables.
func (o *OperationKit) Validate() error {
	err := o.kit.variablesValidator.Validate(o.kit.doc, o.operationParser.executor.Definition, o.parsedOperation.Variables)
	if err != nil {
		return &inputError{
			message:    err.Error(),
			statusCode: http.StatusBadRequest,
		}
	}

	return nil
}

func NewOperationParser(opts OperationParserOptions) *OperationParser {
	return &OperationParser{
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
					),
					printer:             &astprinter.Printer{},
					normalizedOperation: &bytes.Buffer{},
					unescapedDocument:   make([]byte, 1024),
					variablesValidator:  variablesvalidation.NewVariablesValidator(),
				}
			},
		},
	}
}

func (p *OperationParser) getKit() *parseKit {
	return p.parseKitPool.Get().(*parseKit)
}

func (p *OperationParser) freeKit(kit *parseKit) {
	kit.keyGen.Reset()
	kit.doc.Reset()
	kit.normalizedOperation.Reset()
	kit.unescapedDocument = kit.unescapedDocument[:0]
}

func (p *OperationParser) entityTooLarge() error {
	return &inputError{
		message:    "request body too large",
		statusCode: http.StatusRequestEntityTooLarge,
	}
}

func (p *OperationParser) ReadBody(buf *bytes.Buffer, r io.Reader) ([]byte, error) {
	// Use an extra byte for the max size. This way we can check if N became
	// zero to detect if the request body was too large.
	limitedReader := &io.LimitedReader{R: r, N: p.maxOperationSizeInBytes + 1}
	if _, err := io.Copy(buf, limitedReader); err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	if limitedReader.N == 0 {
		return nil, p.entityTooLarge()
	}

	return buf.Bytes(), nil
}

func (p *OperationParser) NewParseReader(r io.Reader) (*OperationKit, error) {
	buf := pool.GetBytesBuffer()
	defer pool.PutBytesBuffer(buf)
	data, err := p.ReadBody(buf, r)
	if err != nil {
		return nil, err
	}
	return NewOperationKit(p, data), nil
}

func (p *OperationParser) NewParser(data []byte) (*OperationKit, error) {
	if len(data) > int(p.maxOperationSizeInBytes) {
		return nil, p.entityTooLarge()
	}
	return NewOperationKit(p, data), nil
}
