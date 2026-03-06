package yokoclient

import (
	"context"
	"fmt"
	"strings"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astvalidation"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

// MockClient is a mock implementation of YokoClient for development and testing.
// It returns hardcoded or template-based responses for known prompt patterns
// and validates generated queries against the schema.
type MockClient struct {
	schema *ast.Document
}

// NewMockClient creates a new mock Yoko client.
func NewMockClient(schema *ast.Document) *MockClient {
	return &MockClient{schema: schema}
}

// Generate returns mock query results based on prompt pattern matching.
func (m *MockClient) Generate(_ context.Context, prompt string, _ string) ([]QueryResult, error) {
	if strings.TrimSpace(prompt) == "" {
		return nil, fmt.Errorf("prompt cannot be empty")
	}

	promptLower := strings.ToLower(prompt)

	// Try known patterns first
	results := m.matchPatterns(promptLower)

	// Fallback: generate a query from the first root query field
	if len(results) == 0 {
		results = m.fallbackQuery()
	}

	// Validate all generated queries against the schema
	var valid []QueryResult
	for _, r := range results {
		if m.validateQuery(r.Query) {
			valid = append(valid, r)
		}
	}

	if len(valid) == 0 {
		return nil, fmt.Errorf("could not generate a valid query for the given prompt")
	}

	return valid, nil
}

func (m *MockClient) matchPatterns(promptLower string) []QueryResult {
	var results []QueryResult

	if m.schema == nil {
		return results
	}

	// Iterate root query fields to find matches
	queryNode, ok := m.findRootType(ast.OperationTypeQuery)
	if !ok {
		return results
	}

	refs := m.schema.ObjectTypeDefinitions[queryNode].FieldsDefinition.Refs
	for _, fieldRef := range refs {
		fieldName := m.schema.FieldDefinitionNameString(fieldRef)
		fieldNameLower := strings.ToLower(fieldName)

		if strings.Contains(promptLower, fieldNameLower) {
			// Skip fields with required arguments (mock can't fill them)
			if m.hasRequiredArgs(fieldRef) {
				continue
			}
			query := m.buildQueryForField(fieldRef, fieldName)
			if query != "" {
				desc := fmt.Sprintf("Query '%s' matching prompt", fieldName)
				results = append(results, QueryResult{
					Query:       query,
					Description: desc,
				})
			}
		}
	}

	return results
}

func (m *MockClient) fallbackQuery() []QueryResult {
	if m.schema == nil {
		return nil
	}

	queryNode, ok := m.findRootType(ast.OperationTypeQuery)
	if !ok {
		return nil
	}

	refs := m.schema.ObjectTypeDefinitions[queryNode].FieldsDefinition.Refs
	if len(refs) == 0 {
		return nil
	}

	// Find the first field without required arguments
	for _, fieldRef := range refs {
		if m.hasRequiredArgs(fieldRef) {
			continue
		}
		fieldName := m.schema.FieldDefinitionNameString(fieldRef)
		query := m.buildQueryForField(fieldRef, fieldName)
		if query != "" {
			return []QueryResult{
				{
					Query:       query,
					Description: fmt.Sprintf("Default query for '%s'", fieldName),
				},
			}
		}
	}
	return nil
}

func (m *MockClient) buildQueryForField(fieldRef int, fieldName string) string {
	// Get the return type name (unwraps NonNull/List)
	typeName := m.schema.FieldDefinitionTypeNameString(fieldRef)
	if typeName == "" {
		return fmt.Sprintf("{ %s }", fieldName)
	}

	// Check if it's a scalar (no subfields needed)
	if m.isScalar(typeName) {
		return fmt.Sprintf("{ %s }", fieldName)
	}

	// Get fields of the return type
	subFields := m.getTypeFields(typeName)
	if len(subFields) == 0 {
		return fmt.Sprintf("{ %s }", fieldName)
	}

	// Select up to 5 scalar fields
	var selected []string
	for _, sf := range subFields {
		sfTypeName := m.schema.FieldDefinitionTypeNameString(sf)
		if m.isScalar(sfTypeName) {
			selected = append(selected, m.schema.FieldDefinitionNameString(sf))
		}
		if len(selected) >= 5 {
			break
		}
	}

	if len(selected) == 0 {
		return fmt.Sprintf("{ %s }", fieldName)
	}

	return fmt.Sprintf("{ %s { %s } }", fieldName, strings.Join(selected, " "))
}

func (m *MockClient) hasRequiredArgs(fieldRef int) bool {
	if !m.schema.FieldDefinitionHasArgumentsDefinitions(fieldRef) {
		return false
	}
	argRefs := m.schema.FieldDefinitions[fieldRef].ArgumentsDefinition.Refs
	for _, argRef := range argRefs {
		typeRef := m.schema.InputValueDefinitionType(argRef)
		t := m.schema.Types[typeRef]
		if t.TypeKind == ast.TypeKindNonNull && !m.schema.InputValueDefinitions[argRef].DefaultValue.IsDefined {
			return true
		}
	}
	return false
}

// mockBuiltinScalars is the set of built-in GraphQL scalar types.
var mockBuiltinScalars = map[string]struct{}{
	"String": {}, "Int": {}, "Float": {}, "Boolean": {}, "ID": {},
}

func (m *MockClient) isScalar(typeName string) bool {
	if _, ok := mockBuiltinScalars[typeName]; ok {
		return true
	}
	// Check if it's defined as a scalar in the schema
	for _, node := range m.schema.RootNodes {
		if node.Kind == ast.NodeKindScalarTypeDefinition {
			if m.schema.ScalarTypeDefinitionNameString(node.Ref) == typeName {
				return true
			}
		}
	}
	return false
}

func (m *MockClient) getTypeFields(typeName string) []int {
	for _, node := range m.schema.RootNodes {
		if node.Kind == ast.NodeKindObjectTypeDefinition {
			if m.schema.ObjectTypeDefinitionNameString(node.Ref) == typeName {
				return m.schema.ObjectTypeDefinitions[node.Ref].FieldsDefinition.Refs
			}
		}
	}
	return nil
}

func (m *MockClient) findRootType(opType ast.OperationType) (int, bool) {
	for _, node := range m.schema.RootNodes {
		if node.Kind == ast.NodeKindObjectTypeDefinition {
			name := m.schema.ObjectTypeDefinitionNameString(node.Ref)
			switch opType {
			case ast.OperationTypeQuery:
				if name == "Query" {
					return node.Ref, true
				}
			case ast.OperationTypeMutation:
				if name == "Mutation" {
					return node.Ref, true
				}
			}
		}
	}
	return -1, false
}

func (m *MockClient) validateQuery(queryStr string) bool {
	if m.schema == nil {
		return false
	}

	opDoc, report := astparser.ParseGraphqlDocumentString(queryStr)
	if report.HasErrors() {
		return false
	}

	validator := astvalidation.DefaultOperationValidator()
	validationReport := &operationreport.Report{}
	validator.Validate(&opDoc, m.schema, validationReport)

	return !validationReport.HasErrors()
}
