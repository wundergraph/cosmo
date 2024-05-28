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
	"github.com/goccy/go-json"
	"github.com/pkg/errors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/variablesvalidation"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/pool"
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

// OperationProcessor provides shared resources to the parseKit and OperationKit.
// It should be only instantiated once and shared across requests
type OperationProcessor struct {
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

// OperationKit provides methods to parse, normalize and validate operations.
// After each step, the operation is available as a ParsedOperation.
// It must be created for each request and freed after the request is done.
type OperationKit struct {
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
func NewOperationKit(parser *OperationProcessor, data []byte) *OperationKit {
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
		operationCount                  = 0
		anonymousOperationCount         = 0
		anonymousOperationDefinitionRef = -1
		operationType                   string
		request                         GraphQLRequest
		extensions                      GraphQLRequestExtensions
	)

	err := json.Unmarshal(o.data, &request)
	if err != nil {
		return &inputError{
			message:    fmt.Sprintf("error parsing request body: %s", err),
			statusCode: http.StatusBadRequest,
		}
	}
	if request.Extensions != nil {
		var mapExtensions map[string]any
		err = json.Unmarshal(request.Extensions, &mapExtensions)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing extensions: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		err = json.Unmarshal(request.Extensions, &extensions)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing extensions: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
		if extensions.PersistedQuery != nil {
			// Delete persistedQuery from extensions to avoid it being passed to the subgraphs
			request.Extensions = jsonparser.Delete(request.Extensions, "persistedQuery")
		}
	}
	if request.Variables != nil {
		var mapVariables map[string]any
		err = json.Unmarshal(request.Variables, &mapVariables)
		if err != nil {
			return &inputError{
				message:    fmt.Sprintf("error parsing variables: %s", err),
				statusCode: http.StatusBadRequest,
			}
		}
	}

	if extensions.PersistedQuery != nil && len(extensions.PersistedQuery.Sha256Hash) > 0 {
		if o.operationParser.cdn == nil {
			return &inputError{
				message:    "could not resolve persisted query, feature is not configured",
				statusCode: http.StatusOK,
			}
		}
		persistedOperationData, err := o.operationParser.cdn.PersistedOperation(ctx, clientInfo.Name, extensions.PersistedQuery.Sha256Hash)
		if err != nil {
			return err
		}
		request.Query = string(persistedOperationData)
	}

	if request.OperationName == "null" {
		request.OperationName = ""
	}

	if len(request.Query) == 0 {
		return &inputError{
			message:    "error parsing request body",
			statusCode: http.StatusBadRequest,
		}
	}

	report := &operationreport.Report{}
	o.kit.doc.Input.ResetInputString(request.Query)
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
		if request.OperationName == "" {
			o.operationDefinitionRef = ref
			o.originalOperationNameRef = o.kit.doc.OperationDefinitions[ref].Name
			request.OperationName = name
			continue
		}
		if name == request.OperationName && o.operationDefinitionRef == -1 {
			o.operationDefinitionRef = ref
			o.originalOperationNameRef = o.kit.doc.OperationDefinitions[ref].Name
		}
	}

	if request.OperationName == "" && operationCount > 1 {
		return &inputError{
			message:    "operation name is required when multiple operations are defined",
			statusCode: http.StatusOK,
		}
	}

	if request.OperationName != "" && operationCount != 0 && o.operationDefinitionRef == -1 {
		return &inputError{
			message:    fmt.Sprintf("operation with name '%s' not found", request.OperationName),
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
				message:    fmt.Sprintf("operation with name '%s' not found", request.OperationName),
				statusCode: http.StatusOK,
			}
		}
	}

	switch o.kit.doc.OperationDefinitions[o.operationDefinitionRef].OperationType {
	case ast.OperationTypeQuery:
		operationType = "query"
	case ast.OperationTypeMutation:
		operationType = "mutation"
	case ast.OperationTypeSubscription:
		operationType = "subscription"
	default:
		return &inputError{
			message:    "operation type not supported",
			statusCode: http.StatusOK,
		}
	}

	// set variables to empty object if they are null or not present
	if request.Variables == nil || bytes.Equal(request.Variables, []byte("null")) {
		request.Variables = []byte("{}")
	}

	// Set variables on doc input before normalization
	// IMPORTANT: this is required for the normalization to work correctly!
	// Normalization reads/rewrites/adds variables
	o.kit.doc.Input.Variables = request.Variables

	// Replace the operation name with a static name to avoid different IDs for the same operation
	replaceOperationName := o.kit.doc.Input.AppendInputBytes(staticOperationName)
	o.kit.doc.OperationDefinitions[o.operationDefinitionRef].Name = replaceOperationName

	// Here we create a copy of the original variables. After parse, the variables can be consumed or modified.
	variablesCopy := make([]byte, len(o.kit.doc.Input.Variables))
	copy(variablesCopy, o.kit.doc.Input.Variables)

	o.parsedOperation = &ParsedOperation{
		ID:                       0,  // will be set after normalization
		NormalizedRepresentation: "", // will be set after normalization
		Name:                     request.OperationName,
		Type:                     operationType,
		Extensions:               request.Extensions,
		Variables:                variablesCopy,
	}

	if extensions.PersistedQuery != nil {
		o.parsedOperation.PersistedID = extensions.PersistedQuery.Sha256Hash
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
			statusCode: http.StatusOK,
		}
	}

	return nil
}

func NewOperationParser(opts OperationParserOptions) *OperationProcessor {
	return &OperationProcessor{
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
					unescapedDocument:   make([]byte, 1024),
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
	kit.unescapedDocument = kit.unescapedDocument[:0]
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
	return NewOperationKit(p, data), nil
}

// NewKit creates a new OperationKit. The kit is used to parse, normalize and
// validate operations. It also validates if the operation size is within the
// limit.
func (p *OperationProcessor) NewKit(data []byte) (*OperationKit, error) {
	if len(data) > int(p.maxOperationSizeInBytes) {
		return nil, p.entityTooLarge()
	}
	return NewOperationKit(p, data), nil
}
