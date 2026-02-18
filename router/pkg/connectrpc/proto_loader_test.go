package connectrpc

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// setupTestProtoLoaderFromDir is a helper to load proto files from a directory.
// This helper is shared across test files to avoid duplication.
func setupTestProtoLoaderFromDir(t *testing.T, dir string) *ProtoLoader {
	t.Helper()
	loader := NewProtoLoader(zap.NewNop())
	require.NoError(t, loader.LoadFromDirectory(dir))
	return loader
}

func TestLoadEmployeeProto(t *testing.T) {
	t.Run("loads and parses employee.proto successfully", func(t *testing.T) {
		loader := setupTestProtoLoaderFromDir(t, "testdata/services/employee.v1")

		// Verify the service was loaded
		services := loader.GetServices()
		assert.Len(t, services, 1, "Should load exactly one service from employee_only directory")

		// Check the EmployeeService
		service, ok := loader.GetService("employee.v1.EmployeeService")
		require.True(t, ok, "EmployeeService should be loaded")

		assert.Equal(t, "employee.v1.EmployeeService", service.FullName)
		assert.Equal(t, "employee.v1", service.Package)
		assert.Equal(t, "EmployeeService", service.ServiceName)

		// Verify expected methods are present
		methodNames := make([]string, len(service.Methods))
		for i, method := range service.Methods {
			methodNames[i] = method.Name
		}

		expectedMethods := []string{
			"UpdateEmployeeMood",
			"FindEmployeesByPets",
			"FindEmployeesByPetsInlineFragment",
			"FindEmployeesByPetsNamedFragment",
			"GetEmployeeById",
			"GetEmployees",
			"GetEmployeesWithMood",
		}

		// Verify we have at least the expected methods (allows for future additions)
		assert.GreaterOrEqual(t, len(service.Methods), len(expectedMethods))

		for _, expected := range expectedMethods {
			assert.Contains(t, methodNames, expected, "Method %s should be present", expected)
		}
	})

	t.Run("verifies query method details", func(t *testing.T) {
		loader := setupTestProtoLoaderFromDir(t, "testdata/services/employee.v1")

		method, err := loader.GetMethod("employee.v1.EmployeeService", "GetEmployeeById")
		require.NoError(t, err)

		assert.Equal(t, "GetEmployeeById", method.Name)
		assert.Equal(t, "employee.v1.EmployeeService.GetEmployeeById", method.FullName)
		assert.Equal(t, "employee.v1.GetEmployeeByIdRequest", method.InputType)
		assert.Equal(t, "employee.v1.GetEmployeeByIdResponse", method.OutputType)
		assert.False(t, method.IsClientStreaming)
		assert.False(t, method.IsServerStreaming)
	})

	t.Run("verifies mutation method details", func(t *testing.T) {
		loader := setupTestProtoLoaderFromDir(t, "testdata/services/employee.v1")

		method, err := loader.GetMethod("employee.v1.EmployeeService", "UpdateEmployeeMood")
		require.NoError(t, err)

		assert.Equal(t, "UpdateEmployeeMood", method.Name)
		assert.Equal(t, "employee.v1.EmployeeService.UpdateEmployeeMood", method.FullName)
		assert.Equal(t, "employee.v1.UpdateEmployeeMoodRequest", method.InputType)
		assert.Equal(t, "employee.v1.UpdateEmployeeMoodResponse", method.OutputType)
		assert.False(t, method.IsClientStreaming)
		assert.False(t, method.IsServerStreaming)
	})

	t.Run("verifies all query methods are present", func(t *testing.T) {
		loader := setupTestProtoLoaderFromDir(t, "testdata/services/employee.v1")

		queryMethods := []string{
			"FindEmployeesByPets",
			"FindEmployeesByPetsInlineFragment",
			"FindEmployeesByPetsNamedFragment",
			"GetEmployeeById",
			"GetEmployees",
			"GetEmployeesWithMood",
		}

		for _, methodName := range queryMethods {
			method, err := loader.GetMethod("employee.v1.EmployeeService", methodName)
			require.NoError(t, err, "Method %s should be found", methodName)
			assert.NotNil(t, method)
			assert.False(t, method.IsClientStreaming, "Query method %s should not be client streaming", methodName)
			assert.False(t, method.IsServerStreaming, "Query method %s should not be server streaming", methodName)
		}
	})

}
