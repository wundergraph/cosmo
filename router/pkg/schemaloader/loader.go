package schemaloader

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
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

		op, ok := l.loadOperation(validator, string(content), zap.String("file", path))
		if !ok {
			return nil
		}

		// if not the operation name, use the file name without the extension
		if op.Name == "" {
			op.Name = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
		}

		// Check if the operation name is unique
		for _, existing := range operations {
			if existing.Name == op.Name {
				l.Logger.Error("MCP operation already exists", zap.String("operation", op.Name), zap.String("file", path))
				return nil
			}
		}

		op.FilePath = path
		operations = append(operations, op)

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking mcp operations directory %s: %w", dirPath, err)
	}

	return operations, nil
}

// LoadOperationsFromManifest loads the operations of a manifest, sorted by key. The key
// of each operation is its name, regardless of the name in the operation body.
func (l *OperationLoader) LoadOperationsFromManifest(manifestOperations map[string]string) []Operation {
	validator := astvalidation.DefaultOperationValidator()

	operations := make([]Operation, 0, len(manifestOperations))
	for _, key := range slices.Sorted(maps.Keys(manifestOperations)) {
		op, ok := l.loadOperation(validator, manifestOperations[key], zap.String("manifest_key", key))
		if !ok {
			continue
		}
		op.Name = key
		operations = append(operations, op)
	}

	return operations
}

// loadOperation parses an operation, strips executable descriptions, and validates it
// against the schema. It logs and reports false for operations that cannot be served.
// The returned name is empty for anonymous operations.
func (l *OperationLoader) loadOperation(validator *astvalidation.OperationValidator, operationString string, source zap.Field) (Operation, bool) {
	// Parse the operation
	opDoc, err := parseOperation(operationString)
	if err != nil {
		l.Logger.Error("Failed to parse MCP operation", source, zap.Error(err))
		return Operation{}, false
	}

	// If the operation carries September-2025-spec executable descriptions
	// (operation/variable/fragment), re-print without them so the string
	// forwarded to upstream GraphQL servers stays valid for servers that
	// don't yet support the new spec. Otherwise reuse the raw content.
	if HasExecutableDescriptions(&opDoc) {
		operationString, err = PrintOperationWithoutDescriptions(&opDoc)
		if err != nil {
			l.Logger.Error("Failed to print MCP operation", source, zap.Error(err))
			return Operation{}, false
		}
	}

	// Extract the operation name and type
	opName, opType, err := GetOperationNameAndType(&opDoc)
	if err != nil {
		l.Logger.Error("Failed to extract MCP operation name and type", zap.String("operation", opName), source, zap.Error(err))
		return Operation{}, false
	}

	// Check if the operation type is supported
	if opType == "subscription" {
		l.Logger.Error("Subscriptions in MCP are not supported yet", zap.String("operation", opName), source)
		return Operation{}, false
	}

	// Validate operation against schema
	validationReport := operationreport.Report{}
	validationState := validator.Validate(&opDoc, l.SchemaDocument, &validationReport)
	if validationState == astvalidation.Invalid {
		l.Logger.Error("Invalid MCP operation",
			zap.String("operation", opName),
			source,
			zap.String("errors", validationReport.Error()))
		return Operation{}, false
	}

	return Operation{
		Name:            opName,
		Document:        opDoc,
		OperationString: operationString,
		OperationType:   opType,
		Description:     extractOperationDescription(&opDoc),
	}, true
}

// isGraphQLFile checks if a file is a GraphQL file based on its extension
func isGraphQLFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".graphql" || ext == ".gql"
}

// parseOperation parses a GraphQL operation string into an AST document
func parseOperation(operation string) (ast.Document, error) {
	opDoc, report := astparser.ParseGraphqlDocumentString(operation)
	if report.HasErrors() {
		return ast.Document{}, fmt.Errorf("parsing errors: %s", report.Error())
	}

	operationCount := len(opDoc.OperationDefinitions)
	if operationCount != 1 {
		return ast.Document{}, fmt.Errorf("expected exactly one operation definition, got %d", operationCount)
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
