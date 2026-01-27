package connectrpc

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// setupHandlerWithSchema creates a handler with loaded proto schema for testing
func setupHandlerWithSchema(t *testing.T) *RPCHandler {
	logger := zap.NewNop()

	// Load proto schema from testdata
	protoLoader := NewProtoLoader(logger)
	testdataDir := filepath.Join("testdata")
	err := protoLoader.LoadFromDirectory(testdataDir)
	require.NoError(t, err, "failed to load test proto files")

	return &RPCHandler{
		logger:      logger,
		protoLoader: protoLoader,
	}
}

func TestConvertProtoJSONToGraphQLVariables(t *testing.T) {
	logger := zap.NewNop()
	handler := &RPCHandler{logger: logger}

	t.Run("preserves camelCase field names from protobuf JSON", func(t *testing.T) {
		// Protobuf JSON already provides camelCase field names
		protoJSON := []byte(`{"employeeId": 1, "firstName": "John"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Field names should be preserved as-is (with ID capitalization)
		assert.JSONEq(t, `{
			"employeeId": 1,
			"firstName": "John"
		}`, string(result))
	})

	t.Run("strips proto enum prefixes with loaded schema", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// Protobuf JSON provides camelCase field names
		protoJSON := []byte(`{"employeeId": "123", "mood": "MOOD_HAPPY"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.EmployeeService", "GetEmployee", protoJSON)
		require.NoError(t, err)

		// With schema loaded, MOOD_HAPPY should become HAPPY
		assert.JSONEq(t, `{
			"employeeId": "123",
			"mood": "HAPPY"
		}`, string(result))
	})

	t.Run("omits _UNSPECIFIED enum values", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		protoJSON := []byte(`{"name": "John", "mood": "MOOD_UNSPECIFIED", "status": "STATUS_ACTIVE"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.EmployeeService", "GetEmployee", protoJSON)
		require.NoError(t, err)

		// MOOD_UNSPECIFIED should be omitted, but name and status should be present
		assert.JSONEq(t, `{
			"name": "John",
			"status": "ACTIVE"
		}`, string(result))
	})

	t.Run("preserves legitimate empty string fields", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// Empty string in a non-enum field should be preserved
		protoJSON := []byte(`{"name": "", "mood": "MOOD_HAPPY"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.EmployeeService", "GetEmployee", protoJSON)
		require.NoError(t, err)

		// Empty string should be preserved (not omitted like UNSPECIFIED enums)
		assert.JSONEq(t, `{
			"name": "",
			"mood": "HAPPY"
		}`, string(result))
	})

	t.Run("handles multiple _UNSPECIFIED enums", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		protoJSON := []byte(`{"name": "John", "mood": "MOOD_UNSPECIFIED", "status": "STATUS_UNSPECIFIED"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.EmployeeService", "GetEmployee", protoJSON)
		require.NoError(t, err)

		// Both UNSPECIFIED enums should be omitted, only name should remain
		assert.JSONEq(t, `{
			"name": "John"
		}`, string(result))
	})

	t.Run("handles multiple enum values without schema", func(t *testing.T) {
		protoJSON := []byte(`{"status": "STATUS_ACTIVE", "role": "ROLE_ADMIN"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Without schema, enum values pass through unchanged
		assert.JSONEq(t, `{
			"status": "STATUS_ACTIVE",
			"role": "ROLE_ADMIN"
		}`, string(result))
	})

	t.Run("handles enum with multiple underscores in value without schema", func(t *testing.T) {
		protoJSON := []byte(`{"visibility": "VISIBILITY_FRIENDS_ONLY"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Without schema, enum values pass through unchanged
		assert.JSONEq(t, `{
			"visibility": "VISIBILITY_FRIENDS_ONLY"
		}`, string(result))
	})

	t.Run("handles nested objects with enums without schema", func(t *testing.T) {
		protoJSON := []byte(`{"user": {"id": 1, "status": "STATUS_ACTIVE"}}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Without schema, enum values pass through unchanged
		assert.JSONEq(t, `{
			"user": {
				"id": 1,
				"status": "STATUS_ACTIVE"
			}
		}`, string(result))
	})

	t.Run("handles arrays with enums without schema", func(t *testing.T) {
		protoJSON := []byte(`{"roles": ["ROLE_ADMIN", "ROLE_USER"]}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Without schema, enum values pass through unchanged
		assert.JSONEq(t, `{
			"roles": ["ROLE_ADMIN", "ROLE_USER"]
		}`, string(result))
	})

	t.Run("does not modify non-enum uppercase strings", func(t *testing.T) {
		protoJSON := []byte(`{"code": "SUCCESS", "name": "JOHN"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Strings without underscores should not be modified
		assert.JSONEq(t, `{
			"code": "SUCCESS",
			"name": "JOHN"
		}`, string(result))
	})

	t.Run("handles empty JSON", func(t *testing.T) {
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", []byte{})
		require.NoError(t, err)
		assert.JSONEq(t, `{}`, string(result))
	})

	t.Run("handles mixed case strings", func(t *testing.T) {
		protoJSON := []byte(`{"message": "Hello_World"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables("test.Service", "TestMethod", protoJSON)
		require.NoError(t, err)

		// Mixed case strings should not be treated as enums
		assert.JSONEq(t, `{
			"message": "Hello_World"
		}`, string(result))
	})
}

