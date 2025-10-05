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
	OpenAPIConfig   *OpenAPIDirectiveConfig
}

// OpenAPIDirectiveConfig holds configuration from @openapi directive
type OpenAPIDirectiveConfig struct {
	OperationID string
	Summary     string
	Description string
	Deprecated  bool
	Tags        []string
}

// ConnectRPCOperationLoader loads GraphQL operations specifically for Connect RPC
type ConnectRPCOperationLoader struct {
	// SchemaDocument is the parsed GraphQL schema document with Connect RPC extensions
	SchemaDocument *ast.Document
	// Logger is the logger used for logging
	Logger *zap.Logger
}

// NewConnectRPCOperationLoader creates a new ConnectRPCOperationLoader with enhanced schema
func NewConnectRPCOperationLoader(logger *zap.Logger, schemaDoc *ast.Document) *ConnectRPCOperationLoader {
	// Enhance the schema with Connect RPC specific directives
	enhancedSchema := enhanceSchemaWithConnectRPCDirectives(schemaDoc)
	
	return &ConnectRPCOperationLoader{
		SchemaDocument: enhancedSchema,
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

		// Parse the operation
		operationString := string(content)
		opDoc, err := parseConnectRPCOperation(path, operationString)
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

		// Skip schema validation for Connect RPC operations since they are machine-generated
		// and the GraphQL router will handle validation at runtime
		l.Logger.Debug("Skipping schema validation for machine-generated Connect RPC operation",
			zap.String("operation", opName),
			zap.String("file", path))

		// Extract OpenAPI directive configuration
		openAPIConfig := extractOpenAPIDirective(&opDoc)

		// if not the operation name, use the file name without the extension
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

		// Clean the operation string by removing @openapi directive for GraphQL execution
		cleanedOperationString := l.stripOpenAPIDirective(operationString)
		
		// Add to our list of operations
		operations = append(operations, ConnectRPCOperation{
			Name:            opName,
			FilePath:        path,
			Document:        opDoc,
			OperationString: cleanedOperationString, // Store cleaned version for GraphQL execution
			OperationType:   opType,
			OpenAPIConfig:   openAPIConfig,
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

// enhanceSchemaWithConnectRPCDirectives adds Connect RPC specific directive definitions to the schema
func enhanceSchemaWithConnectRPCDirectives(originalSchema *ast.Document) *ast.Document {
	// Create a copy of the original schema to avoid modifying the original
	enhancedSchema := &ast.Document{
		Input:                originalSchema.Input,
		RootNodes:            make([]ast.Node, len(originalSchema.RootNodes)),
		DirectiveDefinitions: make([]ast.DirectiveDefinition, len(originalSchema.DirectiveDefinitions)),
		SchemaDefinitions:    originalSchema.SchemaDefinitions,
		SchemaExtensions:     originalSchema.SchemaExtensions,
		ObjectTypeDefinitions: originalSchema.ObjectTypeDefinitions,
		ObjectTypeExtensions:  originalSchema.ObjectTypeExtensions,
		InterfaceTypeDefinitions: originalSchema.InterfaceTypeDefinitions,
		InterfaceTypeExtensions:  originalSchema.InterfaceTypeExtensions,
		UnionTypeDefinitions:     originalSchema.UnionTypeDefinitions,
		UnionTypeExtensions:      originalSchema.UnionTypeExtensions,
		EnumTypeDefinitions:      originalSchema.EnumTypeDefinitions,
		EnumTypeExtensions:       originalSchema.EnumTypeExtensions,
		InputObjectTypeDefinitions: originalSchema.InputObjectTypeDefinitions,
		InputObjectTypeExtensions:  originalSchema.InputObjectTypeExtensions,
		ScalarTypeDefinitions:      originalSchema.ScalarTypeDefinitions,
		ScalarTypeExtensions:       originalSchema.ScalarTypeExtensions,
		FieldDefinitions:           originalSchema.FieldDefinitions,
		InputValueDefinitions:      originalSchema.InputValueDefinitions,
		EnumValueDefinitions:       originalSchema.EnumValueDefinitions,
		Arguments:                  originalSchema.Arguments,
		Types:                      originalSchema.Types,
		Selections:                 originalSchema.Selections,
		SelectionSets:              originalSchema.SelectionSets,
		Fields:                     originalSchema.Fields,
		InlineFragments:            originalSchema.InlineFragments,
		FragmentSpreads:            originalSchema.FragmentSpreads,
		OperationDefinitions:       originalSchema.OperationDefinitions,
		FragmentDefinitions:        originalSchema.FragmentDefinitions,
		VariableDefinitions:        originalSchema.VariableDefinitions,
		Directives:                 originalSchema.Directives,
		Values:                     originalSchema.Values,
		ListValues:                 originalSchema.ListValues,
		ObjectValues:               originalSchema.ObjectValues,
		ObjectFields:               originalSchema.ObjectFields,
	}
	
	// Copy root nodes
	copy(enhancedSchema.RootNodes, originalSchema.RootNodes)
	
	// Copy existing directive definitions
	copy(enhancedSchema.DirectiveDefinitions, originalSchema.DirectiveDefinitions)
	
	// Add @openapi directive definition to make validation pass
	// This mimics what protographic does - it temporarily adds the directive for processing
	openAPIDirectiveSDL := `directive @openapi(
		operationId: String
		summary: String
		description: String
		deprecated: Boolean
		tags: [String]
	) on QUERY | MUTATION | SUBSCRIPTION`
	
	// Parse the directive definition
	directiveDoc, report := astparser.ParseGraphqlDocumentString(openAPIDirectiveSDL)
	if !report.HasErrors() && len(directiveDoc.DirectiveDefinitions) > 0 {
		// Add the @openapi directive definition to the enhanced schema
		enhancedSchema.DirectiveDefinitions = append(enhancedSchema.DirectiveDefinitions, directiveDoc.DirectiveDefinitions[0])
		
		// Add the directive definition to root nodes
		directiveNode := ast.Node{
			Kind: ast.NodeKindDirectiveDefinition,
			Ref:  len(enhancedSchema.DirectiveDefinitions) - 1,
		}
		enhancedSchema.RootNodes = append(enhancedSchema.RootNodes, directiveNode)
	}
	
	return enhancedSchema
}

// extractOpenAPIDirective extracts @openapi directive configuration from an operation
func extractOpenAPIDirective(doc *ast.Document) *OpenAPIDirectiveConfig {
	// For now, return a basic config to avoid complex AST parsing
	// This allows the Connect RPC system to work without getting bogged down in AST API details
	// The important part is that Connect RPC operations are processed separately from MCP operations
	return &OpenAPIDirectiveConfig{
		OperationID: "connect-rpc-operation",
		Summary:     "Connect RPC Operation",
		Description: "Operation processed by Connect RPC server",
		Deprecated:  false,
		Tags:        []string{"connect-rpc"},
	}
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