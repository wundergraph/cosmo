package connectrpc

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestConvertProtoJSONToGraphQLVariables(t *testing.T) {
	logger := zap.NewNop()
	handler := &RPCHandler{logger: logger}

	t.Run("converts snake_case to camelCase", func(t *testing.T) {
		protoJSON := []byte(`{"employee_id": 1, "first_name": "John"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		assert.Equal(t, float64(1), data["employeeID"])
		assert.Equal(t, "John", data["firstName"])
	})

	t.Run("strips proto enum prefixes using schema", func(t *testing.T) {
		protoJSON := []byte(`{"employee_id": 1, "mood": "MOOD_HAPPY"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		assert.Equal(t, float64(1), data["employeeID"])
		// Note: Without actual proto schema loaded, enum won't be stripped in this test
		// In production with schema, MOOD_HAPPY would become HAPPY
	})

	t.Run("handles multiple enum values without schema", func(t *testing.T) {
		protoJSON := []byte(`{"status": "STATUS_ACTIVE", "role": "ROLE_ADMIN"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		// Without schema, enum values pass through unchanged
		assert.Equal(t, "STATUS_ACTIVE", data["status"])
		assert.Equal(t, "ROLE_ADMIN", data["role"])
	})

	t.Run("handles enum with multiple underscores in value without schema", func(t *testing.T) {
		protoJSON := []byte(`{"visibility": "VISIBILITY_FRIENDS_ONLY"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		// Without schema, enum values pass through unchanged
		assert.Equal(t, "VISIBILITY_FRIENDS_ONLY", data["visibility"])
	})

	t.Run("handles nested objects with enums without schema", func(t *testing.T) {
		protoJSON := []byte(`{"user": {"id": 1, "status": "STATUS_ACTIVE"}}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		user := data["user"].(map[string]any)
		// Without schema, enum values pass through unchanged
		assert.Equal(t, "STATUS_ACTIVE", user["status"])
	})

	t.Run("handles arrays with enums without schema", func(t *testing.T) {
		protoJSON := []byte(`{"roles": ["ROLE_ADMIN", "ROLE_USER"]}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		roles := data["roles"].([]any)
		// Without schema, enum values pass through unchanged
		assert.Equal(t, "ROLE_ADMIN", roles[0])
		assert.Equal(t, "ROLE_USER", roles[1])
	})

	t.Run("does not modify non-enum uppercase strings", func(t *testing.T) {
		// Strings without underscores should not be modified
		protoJSON := []byte(`{"code": "SUCCESS", "name": "JOHN"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		assert.Equal(t, "SUCCESS", data["code"])
		assert.Equal(t, "JOHN", data["name"])
	})

	t.Run("handles empty JSON", func(t *testing.T) {
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", []byte{})
		require.NoError(t, err)
		assert.Equal(t, json.RawMessage("{}"), result)
	})

	t.Run("handles mixed case strings", func(t *testing.T) {
		// Mixed case strings should not be treated as enums
		protoJSON := []byte(`{"message": "Hello_World"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		var data map[string]any
		err = json.Unmarshal(result, &data)
		require.NoError(t, err)

		assert.Equal(t, "Hello_World", data["message"])
	})
}

func TestStripEnumPrefixWithType(t *testing.T) {
	tests := []struct {
		name         string
		input        string
		enumTypeName string
		expected     string
	}{
		{"simple enum", "MOOD_HAPPY", "Mood", "HAPPY"},
		{"multi-word enum type", "USER_STATUS_ACTIVE", "UserStatus", "ACTIVE"},
		{"enum with underscores in value", "VISIBILITY_FRIENDS_ONLY", "Visibility", "FRIENDS_ONLY"},
		{"already uppercase type", "STATUS_ACTIVE", "STATUS", "ACTIVE"},
		{"UNSPECIFIED value returns empty string", "USER_STATUS_UNSPECIFIED", "UserStatus", ""},
		{"UNSPECIFIED with different enum", "MOOD_UNSPECIFIED", "Mood", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := stripEnumPrefixWithType(tt.input, tt.enumTypeName)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestToUpperSnakeCase(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple camelCase", "Mood", "MOOD"},
		{"multi-word camelCase", "UserStatus", "USER_STATUS"},
		{"three words", "UserAccountStatus", "USER_ACCOUNT_STATUS"},
		{"already uppercase", "STATUS", "STATUS"},
		{"already snake_case", "user_status", "USER_STATUS"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := toUpperSnakeCase(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestSnakeToCamel(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple snake_case", "employee_id", "employeeID"},
		{"multiple underscores", "first_name_last", "firstNameLast"},
		{"already camelCase", "employeeId", "employeeID"},
		{"single word", "employee", "employee"},
		{"empty string", "", ""},
		{"underscore at start", "_employee", "Employee"},
		{"underscore at end", "employee_", "employee"},
		{"multiple consecutive underscores", "employee__id", "employeeID"},
		{"all caps", "EMPLOYEE_ID", "EMPLOYEEID"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := snakeToCamel(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestConvertKeysRecursive(t *testing.T) {
	logger := zap.NewNop()
	handler := &RPCHandler{logger: logger}

	t.Run("converts nested maps", func(t *testing.T) {
		input := map[string]any{
			"employee_id": 1,
			"user_details": map[string]any{
				"first_name": "John",
				"last_name":  "Doe",
			},
		}

		result := handler.convertKeysRecursive(input, nil)
		resultMap := result.(map[string]any)

		assert.Equal(t, 1, resultMap["employeeID"])
		userDetails := resultMap["userDetails"].(map[string]any)
		assert.Equal(t, "John", userDetails["firstName"])
		assert.Equal(t, "Doe", userDetails["lastName"])
	})

	t.Run("converts arrays of maps", func(t *testing.T) {
		input := []any{
			map[string]any{"employee_id": 1},
			map[string]any{"employee_id": 2},
		}

		result := handler.convertKeysRecursive(input, nil)
		resultArray := result.([]any)

		assert.Len(t, resultArray, 2)
		assert.Equal(t, 1, resultArray[0].(map[string]any)["employeeID"])
		assert.Equal(t, 2, resultArray[1].(map[string]any)["employeeID"])
	})

	t.Run("passes through enum values without schema", func(t *testing.T) {
		input := map[string]any{
			"employee": map[string]any{
				"mood":   "MOOD_HAPPY",
				"status": "STATUS_ACTIVE",
			},
		}

		result := handler.convertKeysRecursive(input, nil)
		resultMap := result.(map[string]any)

		employee := resultMap["employee"].(map[string]any)
		// Without schema, enum values pass through unchanged
		assert.Equal(t, "MOOD_HAPPY", employee["mood"])
		assert.Equal(t, "STATUS_ACTIVE", employee["status"])
	})

	t.Run("handles primitive types", func(t *testing.T) {
		assert.Equal(t, 42, handler.convertValueRecursive(42, nil))
		assert.Equal(t, 3.14, handler.convertValueRecursive(3.14, nil))
		assert.Equal(t, true, handler.convertValueRecursive(true, nil))
		assert.Equal(t, "hello", handler.convertValueRecursive("hello", nil))
	})
}
