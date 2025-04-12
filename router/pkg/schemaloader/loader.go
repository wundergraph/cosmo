package schemaloader

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// Operation represents a GraphQL operation with its AST document and schema information
type Operation struct {
	Name            string
	FilePath        string
	Document        ast.Document
	OperationString string
	Description     string
	JSONSchema      json.RawMessage
	OperationType   string // "query", "mutation", or "subscription"
}

// OperationLoader loads GraphQL operations from files in a directory
type OperationLoader struct {
	// SchemaDocument is the parsed GraphQL schema document
	SchemaDocument *ast.Document
}

// NewOperationLoader creates a new OperationLoader with the given schema document
func NewOperationLoader(schemaDoc *ast.Document) *OperationLoader {
	return &OperationLoader{
		SchemaDocument: schemaDoc,
	}
}

// LoadOperationsFromDirectory loads all GraphQL operations from files in the specified directory
func (l *OperationLoader) LoadOperationsFromDirectory(dirPath string) ([]Operation, error) {
	var operations []Operation

	// Walk through the directory and process GraphQL files
	err := filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		// Skip directories
		if d.IsDir() {
			return nil
		}

		// Only process GraphQL files
		if !isGraphQLFile(path) {
			return nil
		}

		// Read the file
		content, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("failed to read file %s: %w", path, err)
		}

		// Parse the operation
		report := operationreport.Report{}
		operationString := string(content)
		opDoc, err := parseOperation(path, operationString, &report)
		if err != nil {
			return fmt.Errorf("failed to parse operation in file %s: %w", path, err)
		}

		// Extract the operation name and type
		opName, opType, err := getOperationNameAndType(&opDoc)
		if err != nil {
			return fmt.Errorf("failed to get operation name from file %s: %w", path, err)
		}

		// if not operation name, use the file name
		if opName == "" {
			opName = filepath.Base(path)
		}

		// Add to our list of operations
		operations = append(operations, Operation{
			Name:            opName,
			FilePath:        path,
			Document:        opDoc,
			OperationString: operationString,
			OperationType:   opType,
		})

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking directory %s: %w", dirPath, err)
	}

	return operations, nil
}

// isGraphQLFile checks if a file is a GraphQL file based on its extension
func isGraphQLFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".graphql" || ext == ".gql"
}

// parseOperation parses a GraphQL operation string into an AST document
func parseOperation(path string, operation string, report *operationreport.Report) (ast.Document, error) {
	opDoc, report2 := astparser.ParseGraphqlDocumentString(operation)
	// Use the report that was passed in
	*report = report2

	if report.HasErrors() {
		return ast.Document{}, fmt.Errorf("parsing errors: %s", report.Error())
	}

	// Validate that there is exactly one operation definition
	operationCount := 0
	for _, rootNode := range opDoc.RootNodes {
		if rootNode.Kind == ast.NodeKindOperationDefinition {
			operationCount++
		}
	}

	if operationCount != 1 {
		return ast.Document{}, fmt.Errorf("expected exactly one operation definition in file %s, got %d", path, operationCount)
	}

	return opDoc, nil
}

// getOperationNameAndType extracts the name and type of the first operation in a document
func getOperationNameAndType(doc *ast.Document) (string, string, error) {
	for _, ref := range doc.RootNodes {
		if ref.Kind == ast.NodeKindOperationDefinition {
			opDef := doc.OperationDefinitions[ref.Ref]
			opType := ""
			switch opDef.OperationType {
			case ast.OperationTypeQuery:
				opType = "query"
			case ast.OperationTypeMutation:
				opType = "mutation"
			case ast.OperationTypeSubscription:
				opType = "subscription" // Not supported yet
			default:
				return "", "", fmt.Errorf("unknown operation type %d", opDef.OperationType)
			}

			if opDef.Name.Length() > 0 {
				return doc.Input.ByteSliceString(opDef.Name), opType, nil
			}
			return "", opType, nil
		}
	}
	return "", "", fmt.Errorf("no operation found in document")
}

// getOperationName extracts the name of the first operation in a document
// Kept for backward compatibility
func getOperationName(doc *ast.Document) (string, error) {
	name, _, err := getOperationNameAndType(doc)
	return name, err
}
