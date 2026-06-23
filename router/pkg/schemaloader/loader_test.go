package schemaloader

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
)

// TestLoadOperationsWithDescriptions tests that the OperationLoader properly loads
// operations from files and extracts their descriptions
func TestLoadOperationsWithDescriptions(t *testing.T) {
	// Create a temporary directory for test operations
	tempDir := t.TempDir()

	// Create test operation files
	testFiles := map[string]string{
		"WithDescription.graphql": `"""
This operation finds employees by their ID.
It returns detailed employee information.
"""
query FindEmployee($id: ID!) {
	employee(id: $id) {
		id
		name
		email
	}
}`,
		"WithoutDescription.graphql": `query ListEmployees {
	employees {
		id
		name
	}
}`,
		"SingleLineDescription.graphql": `"""Gets the current user"""
query GetCurrentUser {
	me {
		id
		name
	}
}`,
	}

	// Write test files
	for filename, content := range testFiles {
		err := os.WriteFile(filepath.Join(tempDir, filename), []byte(content), 0644)
		require.NoError(t, err, "Failed to write test file %s", filename)
	}

	// Create a schema that matches all test operations
	schemaStr := `
schema {
	query: Query
}

type Query {
	employee(id: ID!): Employee
	employees: [Employee!]!
	me: User
}

type Employee {
	id: ID!
	name: String!
	email: String!
}

type User {
	id: ID!
	name: String!
}
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "Failed to parse schema")

	// Normalize the schema (required for validation)
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err, "Failed to normalize schema")

	// Load operations with a development logger to see errors
	logger, _ := zap.NewDevelopment()
	loader := NewOperationLoader(logger, &schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(tempDir)
	require.NoError(t, err, "Failed to load operations")

	// Debug: print what we got
	t.Logf("Loaded %d operations", len(operations))
	for _, op := range operations {
		t.Logf("Operation: %s (type: %s, desc: %q)", op.Name, op.OperationType, op.Description)
	}

	require.Len(t, operations, 3, "Expected 3 operations to be loaded")

	// Verify operations
	opMap := make(map[string]Operation)
	for _, op := range operations {
		opMap[filepath.Base(op.FilePath)] = op
	}

	// Test operation with multi-line description
	op1 := opMap["WithDescription.graphql"]
	assert.Equal(t, "FindEmployee", op1.Name)
	assert.Contains(t, op1.Description, "This operation finds employees by their ID")
	assert.Contains(t, op1.Description, "It returns detailed employee information")

	// Test operation without description
	op2 := opMap["WithoutDescription.graphql"]
	assert.Equal(t, "ListEmployees", op2.Name)
	assert.Empty(t, op2.Description, "Operation without description should have empty description")

	// Test operation with single-line description
	op3 := opMap["SingleLineDescription.graphql"]
	assert.Equal(t, "GetCurrentUser", op3.Name)
	assert.Equal(t, "Gets the current user", op3.Description)
}

// TestLoadOperationsValidation tests that invalid operations are properly rejected
func TestLoadOperationsValidation(t *testing.T) {
	tempDir := t.TempDir()

	// Create an invalid operation (references non-existent type)
	invalidOp := `"""This operation is invalid"""
query InvalidQuery {
	nonExistentField {
		id
	}
}
`
	err := os.WriteFile(filepath.Join(tempDir, "Invalid.graphql"), []byte(invalidOp), 0644)
	require.NoError(t, err)

	// Create a simple schema
	schemaStr := `
type Query {
	validField: String
}
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())

	// Load operations - invalid operation should be skipped
	logger := zap.NewNop()
	loader := NewOperationLoader(logger, &schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(tempDir)
	require.NoError(t, err, "LoadOperationsFromDirectory should not return error for invalid operations")
	assert.Len(t, operations, 0, "Invalid operations should be skipped")
}

// TestVariableDescriptionInJSONSchema proves that a description attached to a
// GraphQL variable definition ends up in the JSON schema that the MCP server
// exposes as a tool's InputSchema.
func TestVariableDescriptionInJSONSchema(t *testing.T) {
	schemaStr := `
schema { query: Query }
type Query { employee(id: ID!): Employee }
type Employee { id: ID! name: String! }
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "failed to parse schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	opStr := `query FindEmployee(
  "The unique identifier of the employee to fetch"
  $id: ID!
) {
  employee(id: $id) { id name }
}`
	opDoc, report := astparser.ParseGraphqlDocumentString(opStr)
	require.False(t, report.HasErrors(), "failed to parse operation")

	ops := []Operation{{Name: "FindEmployee", Document: opDoc}}

	builder := NewSchemaBuilder(&schemaDoc)
	require.NoError(t, builder.BuildSchemasForOperations(ops))

	var inputSchema struct {
		Properties map[string]struct {
			Description string `json:"description"`
		} `json:"properties"`
	}
	require.NoError(t, json.Unmarshal(ops[0].JSONSchema, &inputSchema))

	idProp, ok := inputSchema.Properties["id"]
	require.True(t, ok, "expected an 'id' property in the tool input schema")
	require.Equal(t,
		"The unique identifier of the employee to fetch",
		idProp.Description,
		"variable description should be visible in the MCP tool input schema")
}

// TestVariableDescriptionStrippedFromForwardedQuery proves that variable-definition
// descriptions are removed from the OperationString forwarded to upstreams (which
// reject them as invalid GraphQL), while still being retained on the loaded
// Document so they can enrich the MCP tool input schema.
func TestVariableDescriptionStrippedFromForwardedQuery(t *testing.T) {
	schemaStr := `
schema { query: Query }
type Query { country(code: ID!): Country }
type Country { name: String! capital: String }
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "failed to parse schema")
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	tempDir := t.TempDir()
	opFile := `"""
Look up a country.
"""
query GetCountry(
  """
  The ISO 3166-1 alpha-2 code
  """
  $code: ID!
) {
  country(code: $code) { name capital }
}`
	require.NoError(t, os.WriteFile(filepath.Join(tempDir, "GetCountry.graphql"), []byte(opFile), 0644))

	loader := NewOperationLoader(zap.NewNop(), &schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(tempDir)
	require.NoError(t, err)
	require.Len(t, operations, 1)

	op := operations[0]

	// The query forwarded to the upstream must be plain, spec-standard GraphQL.
	require.NotContains(t, op.OperationString, "ISO 3166-1",
		"variable description must be stripped from the forwarded query")
	require.NotContains(t, op.OperationString, "Look up a country",
		"operation description must be stripped from the forwarded query")

	// ...but the description is still retained for MCP tool metadata.
	require.Equal(t, "Look up a country.", op.Description)

	// ...and still reaches the JSON schema built from the loaded Document.
	builder := NewSchemaBuilder(&schemaDoc)
	require.NoError(t, builder.BuildSchemasForOperations(operations))
	require.Contains(t, string(operations[0].JSONSchema), "The ISO 3166-1 alpha-2 code",
		"variable description must still reach the MCP tool input schema")
}

// TestPrintOperationWithoutDescriptionsStripsFragment proves that the printing
// helper also strips fragment-definition descriptions — older upstream servers
// reject them just like operation and variable descriptions.
func TestPrintOperationWithoutDescriptionsStripsFragment(t *testing.T) {
	opStr := `"Top-level op description"
query GetEmployee("var description" $id: ID!) {
  employee(id: $id) { ...EmployeeBasics }
}

"Core employee identification fields used across surfaces."
fragment EmployeeBasics on Employee { id name }`
	opDoc, report := astparser.ParseGraphqlDocumentString(opStr)
	require.False(t, report.HasErrors())

	require.True(t, HasExecutableDescriptions(&opDoc))

	out, err := PrintOperationWithoutDescriptions(&opDoc)
	require.NoError(t, err)

	assert.NotContains(t, out, "Top-level op description")
	assert.NotContains(t, out, "var description")
	assert.NotContains(t, out, "Core employee identification fields")

	// Descriptions are restored on the document so JSON-schema building still sees them.
	assert.True(t, opDoc.OperationDefinitions[0].Description.IsDefined,
		"operation description should be restored after printing")
	assert.True(t, opDoc.VariableDefinitions[0].Description.IsDefined,
		"variable description should be restored after printing")
	assert.True(t, opDoc.FragmentDefinitions[0].Description.IsDefined,
		"fragment description should be restored after printing")
}

// TestLoadOperationsPreservesRawWhenNoDescriptions proves that operations
// without any executable-definition descriptions skip the re-print pass and
// keep the original file content as OperationString (preserves author formatting).
func TestLoadOperationsPreservesRawWhenNoDescriptions(t *testing.T) {
	schemaStr := `
schema { query: Query }
type Query { employees: [Employee!]! }
type Employee { id: ID! name: String! }
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	tempDir := t.TempDir()
	// Distinctive whitespace / comments the astprinter would reformat away.
	raw := "query ListEmployees {\n  # author comment\n  employees {\n    id\n    name\n  }\n}\n"
	require.NoError(t, os.WriteFile(filepath.Join(tempDir, "ListEmployees.graphql"), []byte(raw), 0644))

	loader := NewOperationLoader(zap.NewNop(), &schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(tempDir)
	require.NoError(t, err)
	require.Len(t, operations, 1)
	require.Equal(t, raw, operations[0].OperationString,
		"operations without descriptions should preserve the raw file content")
}

// TestLoadOperationsFromEmptyDirectory tests loading from an empty directory
func TestLoadOperationsFromEmptyDirectory(t *testing.T) {
	tempDir := t.TempDir()

	schemaStr := `type Query { test: String }`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())

	logger := zap.NewNop()
	loader := NewOperationLoader(logger, &schemaDoc)
	operations, err := loader.LoadOperationsFromDirectory(tempDir)
	require.NoError(t, err)
	assert.Len(t, operations, 0, "Empty directory should return no operations")
}
