package core

import (
	"fmt"
	"io"
	"sync"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"github.com/wundergraph/cosmo/router/internal/unsafebytes"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astnormalization"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
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

	// Query is the "query" field value in the JSON payload
	Query string
	// Variables in the "variables" field value in the JSON payload
	Variables []byte
	// NormalizedRepresentation is the normalized representation of the operation
	// as a string. This is provided for modules to be able to access the
	// operation.
	NormalizedRepresentation string
}

type OperationParser struct {
	executor     *Executor
	documentPool *sync.Pool
}

func NewOperationParser(executor *Executor) *OperationParser {
	return &OperationParser{
		executor: executor,
		documentPool: &sync.Pool{
			New: func() interface{} {
				return ast.NewSmallDocument()
			},
		},
	}
}

func (p *OperationParser) ParseReader(r io.Reader) (*ParsedOperation, error) {
	buf := pool.GetBytesBuffer()
	defer pool.PutBytesBuffer(buf)
	if _, err := io.Copy(buf, r); err != nil {
		return nil, fmt.Errorf("failed to read request body: %w", err)
	}
	body := buf.Bytes()
	return p.Parse(body)
}

func (p *OperationParser) Parse(body []byte) (*ParsedOperation, error) {
	requestQuery, _ := jsonparser.GetString(body, "query")
	requestOperationName, _ := jsonparser.GetString(body, "operationName")
	requestVariables, _, _, _ := jsonparser.Get(body, "variables")
	requestOperationType := ""

	doc := p.documentPool.Get().(*ast.Document)
	doc.Reset()
	defer p.documentPool.Put(doc)
	doc.Input.ResetInputString(requestQuery)
	parser := astparser.NewParser()
	report := &operationreport.Report{}
	parser.Parse(doc, report)
	if report.HasErrors() {
		return nil, &reportError{
			report: report,
		}
	}

	if requestOperationName == "" {
		if len(doc.OperationDefinitions) == 1 {
			requestOperationName = string(doc.OperationDefinitionNameBytes(0))
		}
	}

	// Extract the operation type from the first operation that matches the operationName
	for _, op := range doc.OperationDefinitions {
		if doc.Input.ByteSlice(op.Name).String() == requestOperationName {
			switch op.OperationType {
			case ast.OperationTypeQuery:
				requestOperationType = "query"
			case ast.OperationTypeMutation:
				requestOperationType = "mutation"
			case ast.OperationTypeSubscription:
				requestOperationType = "subscription"
			}
			break
		}
	}

	// If multiple operations are defined, but no operationName is set, we return an error
	if len(doc.OperationDefinitions) > 1 && requestOperationName == "" {
		return nil, &inputError{
			message: "operation name is required when multiple operations are defined",
		}
	}

	normalizer := astnormalization.NewNormalizer(true, false)
	requestOperationNameBytes := unsafebytes.StringToBytes(requestOperationName)

	if len(requestOperationNameBytes) == 0 {
		normalizer.NormalizeOperation(doc, p.executor.Definition, report)
	} else {
		normalizer.NormalizeNamedOperation(doc, p.executor.Definition, requestOperationNameBytes, report)
	}

	if report.HasErrors() {
		return nil, &reportError{
			report: report,
		}
	}

	hash := xxhash.New()

	// add the operation name to the hash
	// this is important for multi operation documents to have a different hash for each operation
	// otherwise, the prepared plan cache would return the same plan for all operations
	if _, err := hash.Write(requestOperationNameBytes); err != nil {
		return nil, fmt.Errorf("hash write failed: %w", err)
	}

	printer := &astprinter.Printer{}

	if err := printer.Print(doc, p.executor.Definition, hash); err != nil {
		return nil, fmt.Errorf("unable to print document: %w", err)
	}

	operationID := hash.Sum64() // generate the operation ID

	normalizedOperation := pool.GetBytesBuffer()
	defer pool.PutBytesBuffer(normalizedOperation)
	if err := printer.Print(doc, p.executor.Definition, normalizedOperation); err != nil {
		return nil, fmt.Errorf("unable to print document: %w", err)
	}

	return &ParsedOperation{
		ID:   operationID,
		Name: requestOperationName,
		Type: requestOperationType,

		Query:                    requestQuery,
		Variables:                requestVariables,
		NormalizedRepresentation: normalizedOperation.String(),
	}, nil
}
