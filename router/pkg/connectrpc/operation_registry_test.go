package connectrpc

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

func TestNewOperationRegistry(t *testing.T) {
	t.Run("creates registry with logger", func(t *testing.T) {
		logger := zap.NewNop()
		registry := NewOperationRegistry(logger)

		assert.NotNil(t, registry)
		assert.NotNil(t, registry.logger)
		assert.NotNil(t, registry.operations)
		assert.Equal(t, 0, registry.Count())
	})

	t.Run("creates registry with nil logger", func(t *testing.T) {
		registry := NewOperationRegistry(nil)

		assert.NotNil(t, registry)
		assert.NotNil(t, registry.logger)
		assert.NotNil(t, registry.operations)
	})
}

func TestLoadFromDirectory(t *testing.T) {
	// Create a test schema
	schemaStr := `
schema {
	query: Query
	mutation: Mutation
}

type Query {
	employee(id: ID!): Employee
	employees: [Employee!]!
}

type Mutation {
	updateEmployee(id: ID!, name: String!): Employee
}

type Employee {
	id: ID!
	name: String!
	email: String!
}
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors(), "Failed to parse schema")

	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err, "Failed to normalize schema")

	t.Run("loads operations from directory successfully", func(t *testing.T) {
		tempDir := t.TempDir()

		// Create test operation files
		testFiles := map[string]string{
			"GetEmployee.graphql": `query GetEmployee($id: ID!) {
	employee(id: $id) {
		id
		name
		email
	}
}`,
			"ListEmployees.graphql": `query ListEmployees {
	employees {
		id
		name
	}
}`,
			"UpdateEmployee.graphql": `mutation UpdateEmployee($id: ID!, $name: String!) {
	updateEmployee(id: $id, name: $name) {
		id
		name
	}
}`,
		}

		for filename, content := range testFiles {
			err := os.WriteFile(filepath.Join(tempDir, filename), []byte(content), 0644)
			require.NoError(t, err)
		}

		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadFromDirectory(tempDir, &schemaDoc)

		require.NoError(t, err)
		assert.Equal(t, 3, registry.Count())

		// Verify operations are loaded
		assert.True(t, registry.HasOperation("GetEmployee"))
		assert.True(t, registry.HasOperation("ListEmployees"))
		assert.True(t, registry.HasOperation("UpdateEmployee"))
	})

	t.Run("returns error for empty directory path", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadFromDirectory("", &schemaDoc)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "operations directory cannot be empty")
	})

	t.Run("returns error for nil schema", func(t *testing.T) {
		tempDir := t.TempDir()
		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadFromDirectory(tempDir, nil)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "schema document cannot be nil")
	})

	t.Run("returns error for non-existent directory", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadFromDirectory("/non/existent/path", &schemaDoc)

		assert.Error(t, err)
	})

	t.Run("clears existing operations on reload", func(t *testing.T) {
		tempDir := t.TempDir()

		// Create initial operation
		initialOp := `query Initial { employees { id } }`
		err := os.WriteFile(filepath.Join(tempDir, "Initial.graphql"), []byte(initialOp), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 1, registry.Count())
		assert.True(t, registry.HasOperation("Initial"))

		// Create new operation and reload
		newOp := `query NewOp { employees { name } }`
		err = os.WriteFile(filepath.Join(tempDir, "NewOp.graphql"), []byte(newOp), 0644)
		require.NoError(t, err)

		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 2, registry.Count())
		assert.True(t, registry.HasOperation("Initial"))
		assert.True(t, registry.HasOperation("NewOp"))
	})

	t.Run("handles empty directory", func(t *testing.T) {
		tempDir := t.TempDir()
		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadFromDirectory(tempDir, &schemaDoc)

		require.NoError(t, err)
		assert.Equal(t, 0, registry.Count())
	})
}

func TestGetOperation(t *testing.T) {
	schemaStr := `
type Query {
	employee(id: ID!): Employee
}

type Employee {
	id: ID!
	name: String!
}
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	t.Run("returns operation when found", func(t *testing.T) {
		tempDir := t.TempDir()
		opContent := `query GetEmployee($id: ID!) {
	employee(id: $id) {
		id
		name
	}
}`
		err := os.WriteFile(filepath.Join(tempDir, "GetEmployee.graphql"), []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)

		op := registry.GetOperation("GetEmployee")
		assert.NotNil(t, op)
		assert.Equal(t, "GetEmployee", op.Name)
		assert.Equal(t, "query", op.OperationType)
		assert.Contains(t, op.OperationString, "GetEmployee")
	})

	t.Run("returns nil for non-existent operation", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		op := registry.GetOperation("NonExistent")
		assert.Nil(t, op)
	})

	t.Run("returns nil for empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		op := registry.GetOperation("AnyOperation")
		assert.Nil(t, op)
	})
}

func TestHasOperation(t *testing.T) {
	schemaStr := `type Query { test: String }`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	t.Run("returns true for existing operation", func(t *testing.T) {
		tempDir := t.TempDir()
		opContent := `query TestQuery { test }`
		err := os.WriteFile(filepath.Join(tempDir, "Test.graphql"), []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)

		assert.True(t, registry.HasOperation("TestQuery"))
	})

	t.Run("returns false for non-existent operation", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.False(t, registry.HasOperation("NonExistent"))
	})

	t.Run("returns false for empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.False(t, registry.HasOperation("AnyOperation"))
	})
}

func TestGetAllOperations(t *testing.T) {
	schemaStr := `
type Query {
	field1: String
	field2: String
}
`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	t.Run("returns all operations", func(t *testing.T) {
		tempDir := t.TempDir()

		testFiles := map[string]string{
			"Op1.graphql": `query Op1 { field1 }`,
			"Op2.graphql": `query Op2 { field2 }`,
		}

		for filename, content := range testFiles {
			err := os.WriteFile(filepath.Join(tempDir, filename), []byte(content), 0644)
			require.NoError(t, err)
		}

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)

		operations := registry.GetAllOperations()
		assert.Len(t, operations, 2)

		// Verify operation names
		names := make(map[string]bool)
		for _, op := range operations {
			names[op.Name] = true
		}
		assert.True(t, names["Op1"])
		assert.True(t, names["Op2"])
	})

	t.Run("returns empty slice for empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		operations := registry.GetAllOperations()
		assert.NotNil(t, operations)
		assert.Len(t, operations, 0)
	})

	t.Run("returns copy of operations", func(t *testing.T) {
		tempDir := t.TempDir()
		opContent := `query Test { field1 }`
		err := os.WriteFile(filepath.Join(tempDir, "Test.graphql"), []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)

		operations1 := registry.GetAllOperations()
		operations2 := registry.GetAllOperations()

		// Verify they are different slices
		assert.NotSame(t, &operations1, &operations2)
		assert.Equal(t, len(operations1), len(operations2))
	})
}

func TestCount(t *testing.T) {
	schemaStr := `type Query { test: String }`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	t.Run("returns correct count", func(t *testing.T) {
		tempDir := t.TempDir()

		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.Count())

		// Add one operation
		op1 := `query Op1 { test }`
		err := os.WriteFile(filepath.Join(tempDir, "Op1.graphql"), []byte(op1), 0644)
		require.NoError(t, err)

		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 1, registry.Count())

		// Add another operation
		op2 := `query Op2 { test }`
		err = os.WriteFile(filepath.Join(tempDir, "Op2.graphql"), []byte(op2), 0644)
		require.NoError(t, err)

		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 2, registry.Count())
	})

	t.Run("returns zero for empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.Count())
	})
}

func TestClear(t *testing.T) {
	schemaStr := `type Query { test: String }`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	t.Run("clears all operations", func(t *testing.T) {
		tempDir := t.TempDir()
		opContent := `query Test { test }`
		err := os.WriteFile(filepath.Join(tempDir, "Test.graphql"), []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 1, registry.Count())

		registry.Clear()
		assert.Equal(t, 0, registry.Count())
		assert.False(t, registry.HasOperation("Test"))
	})

	t.Run("can clear empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.Count())

		registry.Clear()
		assert.Equal(t, 0, registry.Count())
	})

	t.Run("can reload after clear", func(t *testing.T) {
		tempDir := t.TempDir()
		opContent := `query Test { test }`
		err := os.WriteFile(filepath.Join(tempDir, "Test.graphql"), []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 1, registry.Count())

		registry.Clear()
		assert.Equal(t, 0, registry.Count())

		err = registry.LoadFromDirectory(tempDir, &schemaDoc)
		require.NoError(t, err)
		assert.Equal(t, 1, registry.Count())
		assert.True(t, registry.HasOperation("Test"))
	})
}

func TestThreadSafety(t *testing.T) {
	schemaStr := `type Query { test: String }`
	schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	tempDir := t.TempDir()
	opContent := `query Test { test }`
	err = os.WriteFile(filepath.Join(tempDir, "Test.graphql"), []byte(opContent), 0644)
	require.NoError(t, err)

	registry := NewOperationRegistry(zap.NewNop())
	err = registry.LoadFromDirectory(tempDir, &schemaDoc)
	require.NoError(t, err)

	t.Run("concurrent reads are safe", func(t *testing.T) {
		done := make(chan bool)

		// Start multiple goroutines reading concurrently
		for i := 0; i < 10; i++ {
			go func() {
				for j := 0; j < 100; j++ {
					_ = registry.GetOperation("Test")
					_ = registry.HasOperation("Test")
					_ = registry.GetAllOperations()
					_ = registry.Count()
				}
				done <- true
			}()
		}

		// Wait for all goroutines to complete
		for i := 0; i < 10; i++ {
			<-done
		}
	})

	t.Run("concurrent read and clear are safe", func(t *testing.T) {
		done := make(chan bool)

		// Start readers
		for i := 0; i < 5; i++ {
			go func() {
				for j := 0; j < 50; j++ {
					_ = registry.GetOperation("Test")
					_ = registry.HasOperation("Test")
				}
				done <- true
			}()
		}

		// Start clearers
		for i := 0; i < 5; i++ {
			go func() {
				for j := 0; j < 50; j++ {
					registry.Clear()
					_ = registry.LoadFromDirectory(tempDir, &schemaDoc)
				}
				done <- true
			}()
		}

		// Wait for all goroutines to complete
		for i := 0; i < 10; i++ {
			<-done
		}
	})
}