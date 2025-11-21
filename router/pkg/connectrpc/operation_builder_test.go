package connectrpc

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOperationBuilder_BuildOperation verifies that the builder correctly constructs
// complete GraphQL operations from proto method definitions, including operation type,
// name, variables, and selection sets.
func TestOperationBuilder_BuildOperation(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	builder := NewOperationBuilder()

	t.Run("query operation with variables", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)

		operation, err := builder.BuildOperation(method)
		require.NoError(t, err)

		expected := `query GetEmployeeById($employeeId: Int!) {
employee {
  id
  tag
  details {
    forename
    surname
    pets {
      name
    }
    location {
      key {
        name
      }
    }
  }
}
}`
		assert.Equal(t, expected, operation)
	})

	t.Run("query operation without variables", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployees")
		require.NoError(t, err)

		operation, err := builder.BuildOperation(method)
		require.NoError(t, err)

		expected := `query GetEmployees {
employees {
  id
  details {
    forename
    surname
    hasChildren
  }
}
}`
		assert.Equal(t, expected, operation)
	})

	t.Run("mutation operation with variables", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "MutationUpdateEmployeeMood")
		require.NoError(t, err)

		operation, err := builder.BuildOperation(method)
		require.NoError(t, err)

		expected := `mutation UpdateEmployeeMood($employeeId: Int!, $mood: Mood!) {
updateMood {
  id
  details {
    forename
    surname
  }
  currentMood
  derivedMood
}
}`
		assert.Equal(t, expected, operation)
	})

	t.Run("query with boolean variable", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryFindEmployeesByPets")
		require.NoError(t, err)

		operation, err := builder.BuildOperation(method)
		require.NoError(t, err)

		expected := `query FindEmployeesByPets($hasPets: Boolean!) {
findEmployees {
  id
  details {
    forename
    surname
    pets {
      name
    }
  }
}
}`
		assert.Equal(t, expected, operation)
	})
}

// TestOperationBuilder_ParseMethodName verifies that method names are correctly parsed
// to extract operation type (query/mutation) and operation name.
func TestOperationBuilder_ParseMethodName(t *testing.T) {
	builder := NewOperationBuilder()

	tests := []struct {
		name           string
		methodName     string
		expectedType   string
		expectedOpName string
		expectError    bool
	}{
		{
			name:           "query method",
			methodName:     "QueryGetEmployeeById",
			expectedType:   "query",
			expectedOpName: "GetEmployeeById",
			expectError:    false,
		},
		{
			name:           "mutation method",
			methodName:     "MutationUpdateEmployeeMood",
			expectedType:   "mutation",
			expectedOpName: "UpdateEmployeeMood",
			expectError:    false,
		},
		{
			name:           "query with multiple words",
			methodName:     "QueryFindEmployeesByPets",
			expectedType:   "query",
			expectedOpName: "FindEmployeesByPets",
			expectError:    false,
		},
		{
			name:        "invalid - no prefix",
			methodName:  "GetEmployeeById",
			expectError: true,
		},
		{
			name:        "invalid - empty after Query",
			methodName:  "Query",
			expectError: true,
		},
		{
			name:        "invalid - empty after Mutation",
			methodName:  "Mutation",
			expectError: true,
		},
		{
			name:        "invalid - empty string",
			methodName:  "",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opType, opName, err := builder.parseMethodName(tt.methodName)

			if tt.expectError {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.expectedType, opType)
				assert.Equal(t, tt.expectedOpName, opName)
			}
		})
	}
}

// TestOperationBuilder_BuildVariableDefinitions verifies that GraphQL variable
// definitions are correctly generated from proto message fields.
func TestOperationBuilder_BuildVariableDefinitions(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	builder := NewOperationBuilder()

	t.Run("single int32 field", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)

		varDefs, err := builder.buildVariableDefinitions(method.InputMessageDescriptor)
		require.NoError(t, err)

		assert.Equal(t, "($employeeId: Int!)", varDefs)
	})

	t.Run("multiple fields with different types", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "MutationUpdateEmployeeMood")
		require.NoError(t, err)

		varDefs, err := builder.buildVariableDefinitions(method.InputMessageDescriptor)
		require.NoError(t, err)

		assert.Equal(t, "($employeeId: Int!, $mood: Mood!)", varDefs)
	})

	t.Run("boolean field", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryFindEmployeesByPets")
		require.NoError(t, err)

		varDefs, err := builder.buildVariableDefinitions(method.InputMessageDescriptor)
		require.NoError(t, err)

		assert.Equal(t, "($hasPets: Boolean!)", varDefs)
	})

	t.Run("empty message - no variables", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployees")
		require.NoError(t, err)

		varDefs, err := builder.buildVariableDefinitions(method.InputMessageDescriptor)
		require.NoError(t, err)

		assert.Empty(t, varDefs, "should return empty string for message with no fields")
	})

	t.Run("nil message descriptor", func(t *testing.T) {
		varDefs, err := builder.buildVariableDefinitions(nil)
		require.NoError(t, err)
		assert.Empty(t, varDefs)
	})
}

// TestOperationBuilder_ProtoTypeToGraphQLType verifies that proto field types
// are correctly converted to GraphQL type strings.
func TestOperationBuilder_ProtoTypeToGraphQLType(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	builder := NewOperationBuilder()

	t.Run("int32 field", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)

		fields := method.InputMessageDescriptor.GetFields()
		require.Len(t, fields, 1)

		gqlType, err := builder.protoTypeToGraphQLType(fields[0])
		require.NoError(t, err)
		assert.Equal(t, "Int!", gqlType)
	})

	t.Run("boolean field", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryFindEmployeesByPets")
		require.NoError(t, err)

		fields := method.InputMessageDescriptor.GetFields()
		require.Len(t, fields, 1)

		gqlType, err := builder.protoTypeToGraphQLType(fields[0])
		require.NoError(t, err)
		assert.Equal(t, "Boolean!", gqlType)
	})

	t.Run("enum field", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "MutationUpdateEmployeeMood")
		require.NoError(t, err)

		fields := method.InputMessageDescriptor.GetFields()
		require.Len(t, fields, 2)

		// Second field is the mood enum
		gqlType, err := builder.protoTypeToGraphQLType(fields[1])
		require.NoError(t, err)
		assert.Equal(t, "Mood!", gqlType)
	})
}

// TestOperationBuilder_FieldNameConversion verifies that proto field names
// in snake_case are correctly converted to GraphQL camelCase.
func TestOperationBuilder_FieldNameConversion(t *testing.T) {
	builder := NewOperationBuilder()

	tests := []struct {
		protoName string
		expected  string
	}{
		{
			protoName: "employee_id",
			expected:  "employeeId",
		},
		{
			protoName: "has_pets",
			expected:  "hasPets",
		},
		{
			protoName: "current_mood",
			expected:  "currentMood",
		},
		{
			protoName: "id",
			expected:  "id",
		},
		{
			protoName: "first_name_last_name",
			expected:  "firstNameLastName",
		},
	}

	for _, tt := range tests {
		t.Run(tt.protoName, func(t *testing.T) {
			result := builder.toGraphQLFieldName(tt.protoName)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestOperationBuilder_AssembleOperation verifies that operation parts are
// correctly assembled into a complete GraphQL operation string.
func TestOperationBuilder_AssembleOperation(t *testing.T) {
	builder := NewOperationBuilder()

	t.Run("query with variables", func(t *testing.T) {
		operation := builder.assembleOperation(
			"query",
			"GetEmployeeById",
			"($id: Int!)",
			"employee {\n  id\n  name\n}\n",
		)

		expected := `query GetEmployeeById($id: Int!) {
employee {
  id
  name
}
}`

		assert.Equal(t, expected, operation)
	})

	t.Run("query without variables", func(t *testing.T) {
		operation := builder.assembleOperation(
			"query",
			"GetEmployees",
			"",
			"employees {\n  id\n}\n",
		)

		expected := `query GetEmployees {
employees {
  id
}
}`

		assert.Equal(t, expected, operation)
	})

	t.Run("mutation with variables", func(t *testing.T) {
		operation := builder.assembleOperation(
			"mutation",
			"UpdateEmployee",
			"($id: Int!, $name: String!)",
			"updateEmployee {\n  id\n}\n",
		)

		expected := `mutation UpdateEmployee($id: Int!, $name: String!) {
updateEmployee {
  id
}
}`

		assert.Equal(t, expected, operation)
	})
}

// TestOperationBuilder_NilMethod verifies error handling when nil method is provided.
func TestOperationBuilder_NilMethod(t *testing.T) {
	builder := NewOperationBuilder()

	operation, err := builder.BuildOperation(nil)
	assert.Error(t, err)
	assert.Empty(t, operation)
	assert.Contains(t, err.Error(), "cannot be nil")
}

// TestOperationBuilder_CompleteOperationFormat verifies that the complete
// operation has proper formatting and structure.
func TestOperationBuilder_CompleteOperationFormat(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	builder := NewOperationBuilder()

	method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
	require.NoError(t, err)

	operation, err := builder.BuildOperation(method)
	require.NoError(t, err)

	// Verify structure
	lines := strings.Split(operation, "\n")
	
	// First line should be the operation declaration
	assert.True(t, strings.HasPrefix(lines[0], "query GetEmployeeById("))
	
	// Should have opening brace
	assert.True(t, strings.Contains(lines[0], "{"))
	
	// Last line should be closing brace
	assert.Equal(t, "}", lines[len(lines)-1])
	
	// Should have proper indentation (2 spaces for nested fields)
	hasIndentation := false
	for _, line := range lines {
		if strings.HasPrefix(line, "  ") && !strings.HasPrefix(line, "    ") {
			hasIndentation = true
			break
		}
	}
	assert.True(t, hasIndentation, "should have proper indentation")
}