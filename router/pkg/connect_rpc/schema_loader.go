package connect_rpc

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.uber.org/zap"
)

// ConnectRPCOperation represents a GraphQL operation specifically for Connect RPC
type ConnectRPCOperation struct {
	Name            string
	FilePath        string
	Document        ast.Document
	OperationString string
	Description     string
	OperationType   string // "query", "mutation", or "subscription"
}

// ConnectRPCOperationLoader loads GraphQL operations specifically for Connect RPC
type ConnectRPCOperationLoader struct {
	// SchemaDocument is the parsed GraphQL schema document with Connect RPC extensions
	SchemaDocument *ast.Document
	// Logger is the logger used for logging
	Logger *zap.Logger
}

// NewConnectRPCOperationLoader creates a new ConnectRPCOperationLoader
func NewConnectRPCOperationLoader(logger *zap.Logger, schemaDoc *ast.Document) *ConnectRPCOperationLoader {
	return &ConnectRPCOperationLoader{
		SchemaDocument: schemaDoc,
		Logger:         logger,
	}
}

// LoadOperationsFromDirectory loads all GraphQL operations from files in the specified directory
func (l *ConnectRPCOperationLoader) LoadOperationsFromDirectory(dirPath string) ([]ConnectRPCOperation, error) {
	var operations []ConnectRPCOperation

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

		// Clean the operation string by removing @openapi directive before parsing
		operationString := string(content)
		cleanedOperationString := l.stripOpenAPIDirective(operationString)

		// Parse the cleaned operation
		opDoc, err := parseConnectRPCOperation(path, cleanedOperationString)
		if err != nil {
			l.Logger.Error("Failed to parse Connect RPC operation", zap.String("file", path), zap.Error(err))
			return nil
		}

		// Extract the operation name and type
		opName, opType, err := getOperationNameAndType(&opDoc)
		if err != nil {
			l.Logger.Error("Failed to extract Connect RPC operation name and type", zap.String("operation", opName), zap.String("file", path), zap.Error(err))
			return nil
		}

		// Check if the operation type is supported
		if opType == "subscription" {
			l.Logger.Error("Subscriptions in Connect RPC are not supported yet", zap.String("operation", opName), zap.String("file", path))
			return nil
		}

		// Use file name as operation name if not found in the operation
		if opName == "" {
			opName = strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
		}

		// Check if the operation name is unique
		for _, op := range operations {
			if op.Name == opName {
				l.Logger.Error("Connect RPC operation already exists", zap.String("operation", opName), zap.String("file", path))
				return nil
			}
		}

		// Add to our list of operations
		operations = append(operations, ConnectRPCOperation{
			Name:            opName,
			FilePath:        path,
			Document:        opDoc,
			OperationString: cleanedOperationString,
			OperationType:   opType,
		})

		l.Logger.Debug("Successfully loaded Connect RPC operation",
			zap.String("operation", opName),
			zap.String("type", opType),
			zap.String("file", path))

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking connect rpc operations directory %s: %w", dirPath, err)
	}

	l.Logger.Info("Loaded Connect RPC operations", zap.Int("count", len(operations)))

	return operations, nil
}


// isGraphQLFile checks if a file is a GraphQL file based on its extension
func isGraphQLFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".graphql" || ext == ".gql"
}

// parseConnectRPCOperation parses a GraphQL operation string into an AST document
func parseConnectRPCOperation(path string, operation string) (ast.Document, error) {
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

// stripOpenAPIDirective removes @openapi directive from GraphQL operation string
// since the GraphQL router doesn't recognize this directive
func (l *ConnectRPCOperationLoader) stripOpenAPIDirective(operationString string) string {
	lines := strings.Split(operationString, "\n")
	var cleanedLines []string
	inOpenAPIDirective := false
	parenCount := 0

	for _, line := range lines {
		// Check if line contains @openapi directive
		if strings.Contains(line, "@openapi") {
			inOpenAPIDirective = true

			// Find the @openapi directive position
			openAPIIndex := strings.Index(line, "@openapi")

			// Keep everything before @openapi (like "query GetEmployeeByID($employeeId: Int!) ")
			beforeDirective := line[:openAPIIndex]

			// Count parentheses to track directive scope
			afterDirective := line[openAPIIndex:]
			parenCount += strings.Count(afterDirective, "(") - strings.Count(afterDirective, ")")

			// Add the part before @openapi, plus opening brace if directive ends on this line
			if parenCount <= 0 {
				// Directive ends on this line, add opening brace
				cleanedLines = append(cleanedLines, strings.TrimSpace(beforeDirective)+" {")
				inOpenAPIDirective = false
			} else {
				// Directive continues, just keep the part before @openapi for now
				if strings.TrimSpace(beforeDirective) != "" {
					cleanedLines = append(cleanedLines, strings.TrimSpace(beforeDirective))
				}
			}
			continue
		}

		// If we're inside the directive, count parentheses and skip line
		if inOpenAPIDirective {
			parenCount += strings.Count(line, "(") - strings.Count(line, ")")
			if parenCount <= 0 {
				// Directive ends, add opening brace for query body
				cleanedLines = append(cleanedLines, "{")
				inOpenAPIDirective = false
			}
			continue
		}

		// Keep lines that are not part of @openapi directive
		cleanedLines = append(cleanedLines, line)
	}

	return strings.Join(cleanedLines, "\n")
}
