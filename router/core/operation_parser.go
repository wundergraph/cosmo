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

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astjson"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
	"go.uber.org/zap"
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
	// operation.
	NormalizedRepresentation string
}

type OperationParser struct {
	executor                *Executor
	maxOperationSizeInBytes int64
	cdn                     *cdn.CDN
	parseKitPool            *sync.Pool
}

type parseKit struct {
	parser              *astparser.Parser
	doc                 *ast.Document
	keyGen              hash.Hash64
	normalizer          *astnormalization.OperationNormalizer
	printer             *astprinter.Printer
	normalizedOperation *bytes.Buffer
	unescapedDocument   []byte
}

type OperationParserOptions struct {
	Executor                *Executor
	MaxOperationSizeInBytes int64
	CDN                     *cdn.CDN
}

func NewOperationParser(opts OperationParserOptions) *OperationParser {
	return &OperationParser{
		executor:                opts.Executor,
		maxOperationSizeInBytes: opts.MaxOperationSizeInBytes,
		cdn:                     opts.CDN,
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

func (p *OperationParser) ParseReader(ctx context.Context, clientInfo *ClientInfo, r io.Reader, log *zap.Logger) (*ParsedOperation, error) {
	// Use an extra byte for the max size. This way we can check if N became
	// zero to detect if the request body was too large.
	limitedReader := &io.LimitedReader{R: r, N: p.maxOperationSizeInBytes + 1}
	buf := pool.GetBytesBuffer()
	defer pool.PutBytesBuffer(buf)

	if _, err := io.Copy(buf, limitedReader); err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}

	if limitedReader.N == 0 {
		return nil, p.entityTooLarge()
	}
	return p.parse(ctx, clientInfo, buf.Bytes(), log)
}

func (p *OperationParser) Parse(ctx context.Context, clientInfo *ClientInfo, data []byte, log *zap.Logger) (*ParsedOperation, error) {
	if len(data) > int(p.maxOperationSizeInBytes) {
		return nil, p.entityTooLarge()
	}
	return p.parse(ctx, clientInfo, data, log)
}

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

func (p *OperationParser) parse(ctx context.Context, clientInfo *ClientInfo, body []byte, log *zap.Logger) (*ParsedOperation, error) {

	var (
		requestOperationType            string
		operationDefinitionRef          = -1
		requestOperationNameBytes       []byte
		operationCount                  = 0
		anonymousOperationCount         = 0
		anonymousOperationDefinitionRef = -1
		originalOperationNameRef        ast.ByteSliceReference
		requestDocumentBytes            []byte
		requestVariableBytes            []byte
		persistedQueryVersion           []byte
		persistedQuerySha256Hash        []byte
	)

	kit := p.getKit()
	defer p.freeKit(kit)

	var parseErr error

	jsonparser.EachKey(body, func(i int, value []byte, valueType jsonparser.ValueType, err error) {
		if err != nil {
			parseErr = err
			return
		}
		switch i {
		case parseOperationKeysQueryIndex:
			requestDocumentBytes, err = jsonparser.Unescape(value, kit.unescapedDocument)
			if err != nil {
				parseErr = fmt.Errorf("error unescaping query: %w", err)
				return
			}
		case parseOperationKeysVariablesIndex:
			requestVariableBytes = value
		case parseOperationKeysOperationNameIndex:
			requestOperationNameBytes = value
		case parseOperationKeysExtensionsIndex:
			persistedQuery, _, _, err := jsonparser.Get(value, "persistedQuery")
			if err != nil {
				parseErr = err
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

	if parseErr != nil {
		return nil, errors.WithStack(parseErr)
	}

	if len(persistedQuerySha256Hash) > 0 {
		persistedOperationData, err := p.cdn.PersistentOperation(ctx, clientInfo.Name, persistedQuerySha256Hash)
		if err != nil {
			return nil, errors.WithStack(err)
		}
		requestDocumentBytes = persistedOperationData
	}

	requestHasOperationName := requestOperationNameBytes != nil && !bytes.Equal(requestOperationNameBytes, literal.NULL)
	if !requestHasOperationName {
		requestOperationNameBytes = nil
	}

	report := &operationreport.Report{}
	kit.doc.Input.ResetInputBytes(requestDocumentBytes)
	kit.parser.Parse(kit.doc, report)
	if report.HasErrors() {
		return nil, &reportError{
			report: report,
		}
	}

	for i := range kit.doc.RootNodes {
		if kit.doc.RootNodes[i].Kind != ast.NodeKindOperationDefinition {
			continue
		}
		operationCount++
		ref := kit.doc.RootNodes[i].Ref
		name := kit.doc.Input.ByteSlice(kit.doc.OperationDefinitions[ref].Name)
		if len(name) == 0 {
			anonymousOperationCount++
			if anonymousOperationDefinitionRef == -1 {
				anonymousOperationDefinitionRef = ref
			}
			continue
		}
		if requestOperationNameBytes == nil {
			operationDefinitionRef = ref
			originalOperationNameRef = kit.doc.OperationDefinitions[ref].Name
			requestOperationNameBytes = name
			continue
		}
		if bytes.Equal(name, requestOperationNameBytes) && operationDefinitionRef == -1 {
			operationDefinitionRef = ref
			originalOperationNameRef = kit.doc.OperationDefinitions[ref].Name
		}
	}

	if !requestHasOperationName && operationCount > 1 {
		return nil, &inputError{
			message:    "operation name is required when multiple operations are defined",
			statusCode: http.StatusOK,
		}
	}

	if requestHasOperationName && operationCount != 0 && operationDefinitionRef == -1 {
		return nil, &inputError{
			message:    fmt.Sprintf("operation with name '%s' not found", string(requestOperationNameBytes)),
			statusCode: http.StatusOK,
		}
	}

	if operationDefinitionRef == -1 {
		if anonymousOperationCount == 1 {
			operationDefinitionRef = anonymousOperationDefinitionRef
		} else if anonymousOperationCount > 1 {
			return nil, &inputError{
				message:    "operation name is required when multiple operations are defined",
				statusCode: http.StatusOK,
			}
		} else {
			return nil, &inputError{
				message:    fmt.Sprintf("operation with name '%s' not found", string(requestOperationNameBytes)),
				statusCode: http.StatusOK,
			}
		}
	}

	switch kit.doc.OperationDefinitions[operationDefinitionRef].OperationType {
	case ast.OperationTypeQuery:
		requestOperationType = "query"
	case ast.OperationTypeMutation:
		requestOperationType = "mutation"
	case ast.OperationTypeSubscription:
		requestOperationType = "subscription"
	}

	// replace the operation name with a static name to avoid different IDs for the same operation
	replaceOperationName := kit.doc.Input.AppendInputBytes(staticOperationName)
	kit.doc.OperationDefinitions[operationDefinitionRef].Name = replaceOperationName
	kit.normalizer.NormalizeNamedOperation(kit.doc, p.executor.Definition, staticOperationName, report)
	if report.HasErrors() {
		return nil, &reportError{
			report: report,
		}
	}
	// hash the normalized operation with the static operation name to avoid different IDs for the same operation
	err := kit.printer.Print(kit.doc, p.executor.Definition, kit.keyGen)
	if err != nil {
		return nil, errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}
	// hash extracted variables
	_, err = kit.keyGen.Write(kit.doc.Input.Variables)
	if err != nil {
		return nil, errors.WithStack(fmt.Errorf("failed to write variables: %w", err))
	}
	operationID := kit.keyGen.Sum64() // generate the operation ID
	// print the operation with the original operation name
	kit.doc.OperationDefinitions[operationDefinitionRef].Name = originalOperationNameRef
	err = kit.printer.Print(kit.doc, p.executor.Definition, kit.normalizedOperation)
	if err != nil {
		return nil, errors.WithStack(fmt.Errorf("failed to print normalized operation: %w", err))
	}

	if requestVariableBytes == nil || bytes.Equal(requestVariableBytes, []byte("null")) {
		requestVariableBytes = []byte("{}")
	}

	js := &astjson.JSON{}
	err = js.ParseObject(requestVariableBytes)
	if err != nil {
		return nil, errors.WithStack(fmt.Errorf("failed to parse variables: %w", err))
	}
	if kit.doc.Input.Variables != nil {
		extractedVariables, err := js.AppendObject(kit.doc.Input.Variables)
		if err != nil {
			return nil, errors.WithStack(fmt.Errorf("failed to append variables: %w", err))
		}
		js.MergeNodes(js.RootNode, extractedVariables)
	}
	merged := bytes.NewBuffer(make([]byte, 0, len(requestVariableBytes)+len(kit.doc.Input.Variables)))
	err = js.PrintRoot(merged)
	if err != nil {
		return nil, errors.WithStack(fmt.Errorf("failed to print variables: %w", err))
	}

	return &ParsedOperation{
		ID:                       operationID,
		Name:                     string(requestOperationNameBytes),
		Type:                     requestOperationType,
		Variables:                merged.Bytes(),
		NormalizedRepresentation: kit.normalizedOperation.String(),
	}, nil
}
