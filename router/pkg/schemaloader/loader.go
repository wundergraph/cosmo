package schemaloader

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astprinter"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
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
	OperationType   string     // "query", "mutation", or "subscription"
	RequiredScopes  [][]string // OR-of-AND scope groups from @requiresScopes (nil = no scope check)
}

// OperationLoader loads GraphQL operations from files in a directory
type OperationLoader struct {
	// SchemaDocument is the parsed GraphQL schema document
	SchemaDocument *ast.Document
	// Logger is the logger used for logging
	Logger *zap.Logger
}

// NewOperationLoader creates a new OperationLoader with the given schema document
func NewOperationLoader(logger *zap.Logger, schemaDoc *ast.Document) *OperationLoader {
	return &OperationLoader{
		SchemaDocument: schemaDoc,
		Logger:         logger,
	}
}

// LoadOperationsFromDirectory loads all GraphQL operations from files in the specified directory
func (l *OperationLoader) LoadOperationsFromDirectory(dirPath string) ([]Operation, error) {
	var operations []Operation

	// Create an operation validator
	validator := astvalidation.DefaultOperationValidator()

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
		operationString := string(content)
		opDoc, err := parseOperation(path, operationString)
		if err != nil {
			l.Logger.Error("Failed to parse MCP operation", zap.String("file", path), zap.Error(err))
			return nil
		}

		// If the operation carries September-2025-spec executable descriptions
		// (operation/variable/fragment), re-print without them so the string
		// forwarded to upstream GraphQL servers stays valid for servers that
		// don't yet support the new spec. Otherwise reuse the raw file content.
		if HasExecutableDescriptions(&opDoc) {
			operationString, err = PrintOperationWithoutDescriptions(&opDoc)
			if err != nil {
				l.Logger.Error("Failed to print MCP operation", zap.String("file", path), zap.Error(err))
				return nil
			}
		}

		// Extract the operation name and type
		opName, opType, err := GetOperationNameAndType(&opDoc)
		if err != nil {
			l.Logger.Error("Failed to extract MCP operation name and type", zap.String("operation", opName), zap.String("file", path), zap.Error(err))
			return nil
		}

		// Check if the operation type is supported
		if opType == "subscription" {
			l.Logger.Error("Subscriptions in MCP are not supported yet", zap.String("operation", opName), zap.String("file", path))
			return nil
		}

		// Validate operation against schema
		validationReport := operationreport.Report{}
		validationState := validator.Validate(&opDoc, l.SchemaDocument, &validationReport)
		if validationState == astvalidation.Invalid {
			l.Logger.Error("Invalid MCP operation",
				zap.String("operation", opName),
				zap.String("file", path),
				zap.String("errors", validationReport.Error()))
			return nil
		}

		// if not the operation name, use the file name without the extension
		if opName == "" {
			opName = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
		}

		// Check if the operation name is unique
		for _, op := range operations {
			if op.Name == opName {
				l.Logger.Error("MCP operation already exists", zap.String("operation", opName), zap.String("file", path))
				return nil
			}
		}

		// Extract description from operation definition
		opDescription := extractOperationDescription(&opDoc)

		// Add to our list of operations
		operations = append(operations, Operation{
			Name:            opName,
			FilePath:        path,
			Document:        opDoc,
			OperationString: operationString,
			OperationType:   opType,
			Description:     opDescription,
		})

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking mcp operations directory %s: %w", dirPath, err)
	}

	return operations, nil
}

// isGraphQLFile checks if a file is a GraphQL file based on its extension
func isGraphQLFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".graphql" || ext == ".gql"
}

// parseOperation parses a GraphQL operation string into an AST document
func parseOperation(path string, operation string) (ast.Document, error) {
	opDoc, report := astparser.ParseGraphqlDocumentString(operation)
	if report.HasErrors() {
		return ast.Document{}, fmt.Errorf("parsing errors: %s", report.Error())
	}

	operationCount := len(opDoc.OperationDefinitions)
	if operationCount != 1 {
		return ast.Document{}, fmt.Errorf("expected exactly one operation definition in file %s, got %d", path, operationCount)
	}

	return opDoc, nil
}

// GetOperationNameAndType extracts the name and type of the first operation in a document
func GetOperationNameAndType(doc *ast.Document) (string, string, error) {
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
				return string(doc.Input.ByteSlice(opDef.Name)), opType, nil
			}
			return "", opType, nil
		}
	}
	return "", "", fmt.Errorf("no operation found in document")
}

// extractOperationDescription extracts the description string from an operation definition
func extractOperationDescription(doc *ast.Document) string {
	for _, ref := range doc.RootNodes {
		if ref.Kind == ast.NodeKindOperationDefinition {
			opDef := doc.OperationDefinitions[ref.Ref]
			if opDef.Description.IsDefined && opDef.Description.Content.Length() > 0 {
				description := string(doc.Input.ByteSlice(opDef.Description.Content))
				return strings.TrimSpace(description)
			}
			return ""
		}
	}
	return ""
}

// HasExecutableDescriptions reports whether the document contains any
// description on an executable definition (operation, variable, fragment) —
// the descriptions added by the September 2025 GraphQL spec that older upstream
// servers will reject.
func HasExecutableDescriptions(doc *ast.Document) bool {
	for i := range doc.OperationDefinitions {
		if doc.OperationDefinitions[i].Description.IsDefined {
			return true
		}
	}
	for i := range doc.VariableDefinitions {
		if doc.VariableDefinitions[i].Description.IsDefined {
			return true
		}
	}
	for i := range doc.FragmentDefinitions {
		if doc.FragmentDefinitions[i].Description.IsDefined {
			return true
		}
	}
	return false
}

// PrintOperationWithoutDescriptions re-prints an executable GraphQL document
// with all executable-definition descriptions hidden, so the result is safe to
// forward to upstream GraphQL servers that don't yet support the September 2025
// spec. The document's description fields are restored before returning so
// other consumers (e.g. MCP JSON schema generation) still see them.
//
// Callers should gate this on HasExecutableDescriptions and reuse the original
// source string when no descriptions are present — re-printing reformats the
// document.
func PrintOperationWithoutDescriptions(doc *ast.Document) (string, error) {
	hiddenOps := make([]int, 0, len(doc.OperationDefinitions))
	for i := range doc.OperationDefinitions {
		if doc.OperationDefinitions[i].Description.IsDefined {
			doc.OperationDefinitions[i].Description.IsDefined = false
			hiddenOps = append(hiddenOps, i)
		}
	}
	hiddenVars := make([]int, 0, len(doc.VariableDefinitions))
	for i := range doc.VariableDefinitions {
		if doc.VariableDefinitions[i].Description.IsDefined {
			doc.VariableDefinitions[i].Description.IsDefined = false
			hiddenVars = append(hiddenVars, i)
		}
	}
	hiddenFrags := make([]int, 0, len(doc.FragmentDefinitions))
	for i := range doc.FragmentDefinitions {
		if doc.FragmentDefinitions[i].Description.IsDefined {
			doc.FragmentDefinitions[i].Description.IsDefined = false
			hiddenFrags = append(hiddenFrags, i)
		}
	}
	defer func() {
		for _, ref := range hiddenOps {
			doc.OperationDefinitions[ref].Description.IsDefined = true
		}
		for _, ref := range hiddenVars {
			doc.VariableDefinitions[ref].Description.IsDefined = true
		}
		for _, ref := range hiddenFrags {
			doc.FragmentDefinitions[ref].Description.IsDefined = true
		}
	}()

	return astprinter.PrintString(doc)
}
