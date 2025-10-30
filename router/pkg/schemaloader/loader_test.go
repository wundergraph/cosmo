package schemaloader

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
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