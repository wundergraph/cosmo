package connectrpc

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestLoadEmployeeProto(t *testing.T) {
	t.Run("loads and parses employee.proto successfully", func(t *testing.T) {
		loader := NewProtoLoader(zap.NewNop())

		// Load the employee.proto file from testdata/employee_only
		err := loader.LoadFromDirectory("testdata/employee_only")
		require.NoError(t, err)

		// Verify the service was loaded
		services := loader.GetServices()
		assert.Len(t, services, 1, "Should load exactly one service from employee_only directory")

		// Check the EmployeeService
		service, ok := loader.GetService("employee.v1.EmployeeService")
		require.True(t, ok, "EmployeeService should be loaded")

		assert.Equal(t, "employee.v1.EmployeeService", service.FullName)
		assert.Equal(t, "employee.v1", service.Package)
		assert.Equal(t, "EmployeeService", service.ServiceName)

		// Verify all 7 methods are present
		assert.Len(t, service.Methods, 7)

		// Verify method names
		methodNames := make([]string, len(service.Methods))
		for i, method := range service.Methods {
			methodNames[i] = method.Name
		}

		expectedMethods := []string{
			"MutationUpdateEmployeeMood",
			"QueryFindEmployeesByPets",
			"QueryFindEmployeesByPetsInlineFragment",
			"QueryFindEmployeesByPetsNamedFragment",
			"QueryGetEmployeeById",
			"QueryGetEmployees",
			"QueryGetEmployeesWithMood",
		}

		for _, expected := range expectedMethods {
			assert.Contains(t, methodNames, expected, "Method %s should be present", expected)
		}
	})

	t.Run("verifies query method details", func(t *testing.T) {
		loader := NewProtoLoader(zap.NewNop())
		err := loader.LoadFromDirectory("testdata/employee_only")
		require.NoError(t, err)

		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)

		assert.Equal(t, "QueryGetEmployeeById", method.Name)
		assert.Equal(t, "employee.v1.EmployeeService.QueryGetEmployeeById", method.FullName)
		assert.Equal(t, "employee.v1.QueryGetEmployeeByIdRequest", method.InputType)
		assert.Equal(t, "employee.v1.QueryGetEmployeeByIdResponse", method.OutputType)
		assert.False(t, method.IsClientStreaming)
		assert.False(t, method.IsServerStreaming)
	})

	t.Run("verifies all query methods are present", func(t *testing.T) {
		loader := NewProtoLoader(zap.NewNop())
		err := loader.LoadFromDirectory("testdata/employee_only")
		require.NoError(t, err)

		queryMethods := []string{
			"QueryFindEmployeesByPets",
			"QueryFindEmployeesByPetsInlineFragment",
			"QueryFindEmployeesByPetsNamedFragment",
			"QueryGetEmployeeById",
			"QueryGetEmployees",
			"QueryGetEmployeesWithMood",
		}

		for _, methodName := range queryMethods {
			method, err := loader.GetMethod("employee.v1.EmployeeService", methodName)
			require.NoError(t, err, "Method %s should be found", methodName)
			assert.NotNil(t, method)
			assert.False(t, method.IsClientStreaming, "Query method %s should not be client streaming", methodName)
			assert.False(t, method.IsServerStreaming, "Query method %s should not be server streaming", methodName)
		}
	})

	t.Run("verifies message types in request and response", func(t *testing.T) {
		loader := NewProtoLoader(zap.NewNop())
		err := loader.LoadFromDirectory("testdata/employee_only")
		require.NoError(t, err)

		// Check a method with complex nested messages
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)

		// Verify the input and output types are correctly parsed
		assert.Equal(t, "employee.v1.QueryGetEmployeeByIdRequest", method.InputType)
		assert.Equal(t, "employee.v1.QueryGetEmployeeByIdResponse", method.OutputType)
	})
}
