package connectrpc

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSelectionGenerator_GenerateSelectionSet verifies that the generator correctly
// produces GraphQL selection sets from proto message descriptors, including handling
// of nested messages, repeated fields, and enums.
func TestSelectionGenerator_GenerateSelectionSet(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	generator := NewSelectionGenerator()

	t.Run("simple message with scalar fields", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployees")
		require.NoError(t, err)

		responseMsg := method.OutputMessageDescriptor
		require.NotNil(t, responseMsg)

		selectionSet, err := generator.GenerateSelectionSet(responseMsg)
		require.NoError(t, err)

		expected := `employees {
  id
  details {
    forename
    surname
    hasChildren
  }
}
`
		assert.Equal(t, expected, selectionSet, "Selection set should match expected output")
	})

	t.Run("message with nested messages", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
		require.NoError(t, err)

		responseMsg := method.OutputMessageDescriptor
		require.NotNil(t, responseMsg)

		selectionSet, err := generator.GenerateSelectionSet(responseMsg)
		require.NoError(t, err)

		expected := `employee {
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
`
		assert.Equal(t, expected, selectionSet, "Selection set should match expected output")
	})

	t.Run("message with repeated fields", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryFindEmployeesByPets")
		require.NoError(t, err)

		responseMsg := method.OutputMessageDescriptor
		require.NotNil(t, responseMsg)

		selectionSet, err := generator.GenerateSelectionSet(responseMsg)
		require.NoError(t, err)

		expected := `findEmployees {
  id
  details {
    forename
    surname
    pets {
      name
    }
  }
}
`
		assert.Equal(t, expected, selectionSet, "Selection set should match expected output")
	})

	t.Run("message with enum fields", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeesWithMood")
		require.NoError(t, err)

		responseMsg := method.OutputMessageDescriptor
		require.NotNil(t, responseMsg)

		selectionSet, err := generator.GenerateSelectionSet(responseMsg)
		require.NoError(t, err)

		expected := `employees {
  id
  details {
    pets {
      name
      gender
    }
  }
  currentMood
}
`
		assert.Equal(t, expected, selectionSet, "Selection set should match expected output")
	})

	t.Run("mutation response message", func(t *testing.T) {
		method, err := loader.GetMethod("employee.v1.EmployeeService", "MutationUpdateEmployeeMood")
		require.NoError(t, err)

		responseMsg := method.OutputMessageDescriptor
		require.NotNil(t, responseMsg)

		selectionSet, err := generator.GenerateSelectionSet(responseMsg)
		require.NoError(t, err)

		expected := `updateMood {
  id
  details {
    forename
    surname
  }
  currentMood
  derivedMood
}
`
		assert.Equal(t, expected, selectionSet, "Selection set should match expected output")
	})
}

// TestSelectionGenerator_FieldNameConversion verifies that proto field names in
// snake_case (e.g., employee_id) are correctly converted to GraphQL camelCase (e.g., employeeId).
func TestSelectionGenerator_FieldNameConversion(t *testing.T) {
	generator := NewSelectionGenerator()

	tests := []struct {
		name      string
		protoName string
		expected  string
	}{
		{
			name:      "single word",
			protoName: "id",
			expected:  "id",
		},
		{
			name:      "two words",
			protoName: "employee_id",
			expected:  "employeeId",
		},
		{
			name:      "three words",
			protoName: "current_mood",
			expected:  "currentMood",
		},
		{
			name:      "multiple words",
			protoName: "has_children",
			expected:  "hasChildren",
		},
		{
			name:      "already camelCase",
			protoName: "forename",
			expected:  "forename",
		},
		{
			name:      "with numbers",
			protoName: "field_1_name",
			expected:  "field1Name",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := generator.toGraphQLFieldName(tt.protoName)
			assert.Equal(t, tt.expected, result)
		})
	}
}

// TestSelectionGenerator_NilMessage verifies that the generator returns an error
// when given a nil message descriptor.
func TestSelectionGenerator_NilMessage(t *testing.T) {
	generator := NewSelectionGenerator()

	selectionSet, err := generator.GenerateSelectionSet(nil)
	assert.Error(t, err)
	assert.Empty(t, selectionSet)
	assert.Contains(t, err.Error(), "cannot be nil")
}

// TestSelectionGenerator_IndentationAndFormatting verifies that the generated selection
// sets have proper indentation (2 spaces per nesting level) and brace formatting.
func TestSelectionGenerator_IndentationAndFormatting(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	generator := NewSelectionGenerator()

	method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
	require.NoError(t, err)

	responseMsg := method.OutputMessageDescriptor
	require.NotNil(t, responseMsg)

	selectionSet, err := generator.GenerateSelectionSet(responseMsg)
	require.NoError(t, err)

	// Check that we have proper indentation (2 spaces per level)
	lines := strings.Split(selectionSet, "\n")

	// Should have lines with different indentation levels
	hasNoIndent := false
	hasTwoSpaces := false
	hasFourSpaces := false
	hasSixSpaces := false

	for _, line := range lines {
		if line == "" {
			continue
		}
		if !strings.HasPrefix(line, " ") {
			hasNoIndent = true
		} else if strings.HasPrefix(line, "      ") {
			hasSixSpaces = true
		} else if strings.HasPrefix(line, "    ") {
			hasFourSpaces = true
		} else if strings.HasPrefix(line, "  ") {
			hasTwoSpaces = true
		}
	}

	assert.True(t, hasNoIndent, "Should have top-level fields with no indent")
	assert.True(t, hasTwoSpaces, "Should have nested fields with 2-space indent")
	assert.True(t, hasFourSpaces, "Should have deeply nested fields with 4-space indent")
	assert.True(t, hasSixSpaces, "Should have very deeply nested fields with 6-space indent")

	// Check for proper brace formatting
	assert.Contains(t, selectionSet, " {")
	assert.Contains(t, selectionSet, "}")
}

// TestSelectionGenerator_EmptyMessage verifies that the generator handles proto messages
// with no fields by returning an empty selection set.
func TestSelectionGenerator_EmptyMessage(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	generator := NewSelectionGenerator()

	// QueryGetEmployeesRequest has no fields
	method, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployees")
	require.NoError(t, err)

	requestMsg := method.InputMessageDescriptor
	require.NotNil(t, requestMsg)

	selectionSet, err := generator.GenerateSelectionSet(requestMsg)
	require.NoError(t, err)
	// Empty message should return empty selection set
	assert.Empty(t, selectionSet)
}

// TestSelectionGenerator_MultipleGenerations verifies that a single SelectionGenerator
// instance can be safely reused to generate selection sets for different proto messages
// without state pollution. This is important for performance as we reuse generators
// across multiple requests rather than creating new instances.
func TestSelectionGenerator_MultipleGenerations(t *testing.T) {
	loader := NewProtoLoader(nil)
	err := loader.LoadFromDirectory("testdata")
	require.NoError(t, err)

	generator := NewSelectionGenerator()

	// Generate selection set for first method
	method1, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployees")
	require.NoError(t, err)
	responseMsg1 := method1.OutputMessageDescriptor

	selectionSet1, err := generator.GenerateSelectionSet(responseMsg1)
	require.NoError(t, err)
	require.NotEmpty(t, selectionSet1)

	// Generate selection set for second method
	method2, err := loader.GetMethod("employee.v1.EmployeeService", "QueryGetEmployeeById")
	require.NoError(t, err)
	responseMsg2 := method2.OutputMessageDescriptor

	selectionSet2, err := generator.GenerateSelectionSet(responseMsg2)
	require.NoError(t, err)
	require.NotEmpty(t, selectionSet2)

	// They should be different
	assert.NotEqual(t, selectionSet1, selectionSet2)

	// First should not contain 'tag' field
	assert.NotContains(t, selectionSet1, "tag")
	// Second should contain 'tag' field
	assert.Contains(t, selectionSet2, "tag")
}
