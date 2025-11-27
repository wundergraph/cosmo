package connectrpc

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestLoadOperationsForService(t *testing.T) {
	t.Run("loads operations for service successfully", func(t *testing.T) {
		tempDir := t.TempDir()
		serviceName := "employee.v1.EmployeeService"

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

		var operationFiles []string
		for filename, content := range testFiles {
			filePath := filepath.Join(tempDir, filename)
			err := os.WriteFile(filePath, []byte(content), 0644)
			require.NoError(t, err)
			operationFiles = append(operationFiles, filePath)
		}

		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadOperationsForService(serviceName, operationFiles)

		require.NoError(t, err)
		assert.Equal(t, 3, registry.CountForService(serviceName))

		// Verify operations are loaded for the service
		assert.True(t, registry.HasOperationForService(serviceName, "GetEmployee"))
		assert.True(t, registry.HasOperationForService(serviceName, "ListEmployees"))
		assert.True(t, registry.HasOperationForService(serviceName, "UpdateEmployee"))
	})

	t.Run("returns error for empty service name", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadOperationsForService("", []string{})

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "service name cannot be empty")
	})

	t.Run("handles empty operation files list", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		serviceName := "test.v1.TestService"
		
		err := registry.LoadOperationsForService(serviceName, []string{})
		
		require.NoError(t, err)
		assert.Equal(t, 0, registry.CountForService(serviceName))
	})

	t.Run("loads operations for multiple services independently", func(t *testing.T) {
		tempDir := t.TempDir()
		
		// Service 1
		service1 := "employee.v1.EmployeeService"
		op1File := filepath.Join(tempDir, "GetEmployee.graphql")
		err := os.WriteFile(op1File, []byte(`query GetEmployee { employee { id } }`), 0644)
		require.NoError(t, err)

		// Service 2
		service2 := "product.v1.ProductService"
		op2File := filepath.Join(tempDir, "GetProduct.graphql")
		err = os.WriteFile(op2File, []byte(`query GetProduct { product { id } }`), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		
		err = registry.LoadOperationsForService(service1, []string{op1File})
		require.NoError(t, err)
		
		err = registry.LoadOperationsForService(service2, []string{op2File})
		require.NoError(t, err)

		// Verify operations are scoped to their services
		assert.True(t, registry.HasOperationForService(service1, "GetEmployee"))
		assert.False(t, registry.HasOperationForService(service1, "GetProduct"))
		
		assert.True(t, registry.HasOperationForService(service2, "GetProduct"))
		assert.False(t, registry.HasOperationForService(service2, "GetEmployee"))
	})
}

func TestGetOperationForService(t *testing.T) {
	t.Run("returns operation when found", func(t *testing.T) {
		tempDir := t.TempDir()
		serviceName := "employee.v1.EmployeeService"
		opContent := `query GetEmployee($id: ID!) {
	employee(id: $id) {
		id
		name
	}
}`
		opFile := filepath.Join(tempDir, "GetEmployee.graphql")
		err := os.WriteFile(opFile, []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadOperationsForService(serviceName, []string{opFile})
		require.NoError(t, err)

		op := registry.GetOperationForService(serviceName, "GetEmployee")
		assert.NotNil(t, op)
		assert.Equal(t, "GetEmployee", op.Name)
		assert.Equal(t, "query", op.OperationType)
		assert.Contains(t, op.OperationString, "GetEmployee")
	})

	t.Run("returns nil for non-existent operation", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		serviceName := "test.v1.TestService"
		op := registry.GetOperationForService(serviceName, "NonExistent")
		assert.Nil(t, op)
	})

	t.Run("returns nil for non-existent service", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		op := registry.GetOperationForService("nonexistent.Service", "AnyOperation")
		assert.Nil(t, op)
	})

	t.Run("operations are isolated between services", func(t *testing.T) {
		tempDir := t.TempDir()
		
		service1 := "service1.v1.Service1"
		service2 := "service2.v1.Service2"
		
		// Both services have an operation with the same name
		opFile1 := filepath.Join(tempDir, "GetData1.graphql")
		err := os.WriteFile(opFile1, []byte(`query GetData { data1 { id } }`), 0644)
		require.NoError(t, err)
		
		opFile2 := filepath.Join(tempDir, "GetData2.graphql")
		err = os.WriteFile(opFile2, []byte(`query GetData { data2 { id } }`), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadOperationsForService(service1, []string{opFile1})
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service2, []string{opFile2})
		require.NoError(t, err)

		// Both services should have their own GetData operation
		op1 := registry.GetOperationForService(service1, "GetData")
		op2 := registry.GetOperationForService(service2, "GetData")
		
		assert.NotNil(t, op1)
		assert.NotNil(t, op2)
		assert.Contains(t, op1.OperationString, "data1")
		assert.Contains(t, op2.OperationString, "data2")
	})
}

func TestHasOperationForService(t *testing.T) {
	t.Run("returns true for existing operation", func(t *testing.T) {
		tempDir := t.TempDir()
		serviceName := "test.v1.TestService"
		opContent := `query TestQuery { test }`
		opFile := filepath.Join(tempDir, "Test.graphql")
		err := os.WriteFile(opFile, []byte(opContent), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadOperationsForService(serviceName, []string{opFile})
		require.NoError(t, err)

		assert.True(t, registry.HasOperationForService(serviceName, "TestQuery"))
	})

	t.Run("returns false for non-existent operation", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.False(t, registry.HasOperationForService("test.Service", "NonExistent"))
	})

	t.Run("returns false for non-existent service", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.False(t, registry.HasOperationForService("nonexistent.Service", "AnyOperation"))
	})
}

func TestGetAllOperationsForService(t *testing.T) {
	t.Run("returns all operations for service", func(t *testing.T) {
		tempDir := t.TempDir()
		serviceName := "test.v1.TestService"

		testFiles := map[string]string{
			"Op1.graphql": `query Op1 { field1 }`,
			"Op2.graphql": `query Op2 { field2 }`,
		}

		var operationFiles []string
		for filename, content := range testFiles {
			filePath := filepath.Join(tempDir, filename)
			err := os.WriteFile(filePath, []byte(content), 0644)
			require.NoError(t, err)
			operationFiles = append(operationFiles, filePath)
		}

		registry := NewOperationRegistry(zap.NewNop())
		err := registry.LoadOperationsForService(serviceName, operationFiles)
		require.NoError(t, err)

		operations := registry.GetAllOperationsForService(serviceName)
		assert.Len(t, operations, 2)

		// Verify operation names
		names := make(map[string]bool)
		for _, op := range operations {
			names[op.Name] = true
		}
		assert.True(t, names["Op1"])
		assert.True(t, names["Op2"])
	})

	t.Run("returns empty slice for non-existent service", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		operations := registry.GetAllOperationsForService("nonexistent.Service")
		assert.NotNil(t, operations)
		assert.Len(t, operations, 0)
	})
}

func TestCountForService(t *testing.T) {
	t.Run("returns correct count for service", func(t *testing.T) {
		tempDir := t.TempDir()
		serviceName := "test.v1.TestService"

		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.CountForService(serviceName))

		// Add operations
		op1File := filepath.Join(tempDir, "Op1.graphql")
		err := os.WriteFile(op1File, []byte(`query Op1 { test }`), 0644)
		require.NoError(t, err)

		err = registry.LoadOperationsForService(serviceName, []string{op1File})
		require.NoError(t, err)
		assert.Equal(t, 1, registry.CountForService(serviceName))
	})

	t.Run("returns zero for non-existent service", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.CountForService("nonexistent.Service"))
	})
}

func TestCount(t *testing.T) {
	t.Run("returns total count across all services", func(t *testing.T) {
		tempDir := t.TempDir()
		
		service1 := "service1.v1.Service1"
		service2 := "service2.v1.Service2"

		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.Count())

		// Add operations to service1
		op1File := filepath.Join(tempDir, "Op1.graphql")
		err := os.WriteFile(op1File, []byte(`query Op1 { test }`), 0644)
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service1, []string{op1File})
		require.NoError(t, err)
		assert.Equal(t, 1, registry.Count())

		// Add operations to service2
		op2File := filepath.Join(tempDir, "Op2.graphql")
		err = os.WriteFile(op2File, []byte(`query Op2 { test }`), 0644)
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service2, []string{op2File})
		require.NoError(t, err)
		assert.Equal(t, 2, registry.Count())
	})
}

func TestGetServiceNames(t *testing.T) {
	t.Run("returns all service names", func(t *testing.T) {
		tempDir := t.TempDir()
		
		service1 := "employee.v1.EmployeeService"
		service2 := "product.v1.ProductService"

		op1File := filepath.Join(tempDir, "Op1.graphql")
		err := os.WriteFile(op1File, []byte(`query Op1 { test }`), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadOperationsForService(service1, []string{op1File})
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service2, []string{op1File})
		require.NoError(t, err)

		names := registry.GetServiceNames()
		assert.Len(t, names, 2)
		assert.Contains(t, names, service1)
		assert.Contains(t, names, service2)
	})

	t.Run("returns empty slice for empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		names := registry.GetServiceNames()
		assert.NotNil(t, names)
		assert.Len(t, names, 0)
	})
}

func TestClear(t *testing.T) {
	t.Run("clears all operations from all services", func(t *testing.T) {
		tempDir := t.TempDir()
		service1 := "service1.v1.Service1"
		service2 := "service2.v1.Service2"
		
		opFile := filepath.Join(tempDir, "Test.graphql")
		err := os.WriteFile(opFile, []byte(`query Test { test }`), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadOperationsForService(service1, []string{opFile})
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service2, []string{opFile})
		require.NoError(t, err)
		assert.Equal(t, 2, registry.Count())

		registry.Clear()
		assert.Equal(t, 0, registry.Count())
		assert.False(t, registry.HasOperationForService(service1, "Test"))
		assert.False(t, registry.HasOperationForService(service2, "Test"))
	})

	t.Run("can clear empty registry", func(t *testing.T) {
		registry := NewOperationRegistry(zap.NewNop())
		assert.Equal(t, 0, registry.Count())

		registry.Clear()
		assert.Equal(t, 0, registry.Count())
	})
}

func TestClearService(t *testing.T) {
	t.Run("clears operations for specific service only", func(t *testing.T) {
		tempDir := t.TempDir()
		service1 := "service1.v1.Service1"
		service2 := "service2.v1.Service2"
		
		opFile := filepath.Join(tempDir, "Test.graphql")
		err := os.WriteFile(opFile, []byte(`query Test { test }`), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		err = registry.LoadOperationsForService(service1, []string{opFile})
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service2, []string{opFile})
		require.NoError(t, err)
		
		assert.Equal(t, 2, registry.Count())

		registry.ClearService(service1)
		
		assert.Equal(t, 1, registry.Count())
		assert.False(t, registry.HasOperationForService(service1, "Test"))
		assert.True(t, registry.HasOperationForService(service2, "Test"))
	})
}

func TestThreadSafety(t *testing.T) {
	tempDir := t.TempDir()
	serviceName := "test.v1.TestService"
	opContent := `query Test { test }`
	opFile := filepath.Join(tempDir, "Test.graphql")
	err := os.WriteFile(opFile, []byte(opContent), 0644)
	require.NoError(t, err)

	registry := NewOperationRegistry(zap.NewNop())
	err = registry.LoadOperationsForService(serviceName, []string{opFile})
	require.NoError(t, err)

	t.Run("concurrent reads are safe", func(t *testing.T) {
		done := make(chan bool)

		// Start multiple goroutines reading concurrently
		for i := 0; i < 10; i++ {
			go func() {
				for j := 0; j < 100; j++ {
					_ = registry.GetOperationForService(serviceName, "Test")
					_ = registry.HasOperationForService(serviceName, "Test")
					_ = registry.GetAllOperationsForService(serviceName)
					_ = registry.Count()
					_ = registry.CountForService(serviceName)
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
					_ = registry.GetOperationForService(serviceName, "Test")
					_ = registry.HasOperationForService(serviceName, "Test")
				}
				done <- true
			}()
		}

		// Start clearers
		for i := 0; i < 5; i++ {
			go func() {
				for j := 0; j < 50; j++ {
					registry.Clear()
					_ = registry.LoadOperationsForService(serviceName, []string{opFile})
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

// Test service-scoped operations with same service names but different packages
func TestServiceScopedOperations(t *testing.T) {
	t.Run("same service name different packages work independently", func(t *testing.T) {
		tempDir := t.TempDir()
		
		// Two services with same name but different packages
		service1 := "company1.employee.v1.EmployeeService"
		service2 := "company2.employee.v1.EmployeeService"
		
		// Create operations with same name for both services
		op1File := filepath.Join(tempDir, "GetEmployee1.graphql")
		err := os.WriteFile(op1File, []byte(`query GetEmployee { company1Employee { id name } }`), 0644)
		require.NoError(t, err)
		
		op2File := filepath.Join(tempDir, "GetEmployee2.graphql")
		err = os.WriteFile(op2File, []byte(`query GetEmployee { company2Employee { id name } }`), 0644)
		require.NoError(t, err)

		registry := NewOperationRegistry(zap.NewNop())
		
		// Load operations for both services
		err = registry.LoadOperationsForService(service1, []string{op1File})
		require.NoError(t, err)
		err = registry.LoadOperationsForService(service2, []string{op2File})
		require.NoError(t, err)

		// Verify both services have their own GetEmployee operation
		op1 := registry.GetOperationForService(service1, "GetEmployee")
		op2 := registry.GetOperationForService(service2, "GetEmployee")
		
		assert.NotNil(t, op1)
		assert.NotNil(t, op2)
		
		// Verify they have different content
		assert.Contains(t, op1.OperationString, "company1Employee")
		assert.Contains(t, op2.OperationString, "company2Employee")
		
		// Verify operations are isolated
		assert.True(t, registry.HasOperationForService(service1, "GetEmployee"))
		assert.True(t, registry.HasOperationForService(service2, "GetEmployee"))
		
		// Verify counts
		assert.Equal(t, 1, registry.CountForService(service1))
		assert.Equal(t, 1, registry.CountForService(service2))
		assert.Equal(t, 2, registry.Count())
	})
}