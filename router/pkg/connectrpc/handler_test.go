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

// TestConvertGraphQLResponseToProtoJSON covers the response direction (GraphQL -> proto),
// the inverse of convertProtoJSONToGraphQLVariables. The GraphQL subgraph emits bare enum
// values (e.g. "HAPPY"), but the proto descriptor only knows the prefixed value names
// (e.g. "MOOD_HAPPY"). Without re-adding the prefix, the Vanguard transcoder cannot map the
// value and silently drops the enum field on the binary wire / falls back to *_UNSPECIFIED on
// the JSON wire. Regression test for https://github.com/wundergraph/cosmo/issues/2924.
func TestConvertGraphQLResponseToProtoJSON(t *testing.T) {
	t.Run("re-adds proto enum prefix to response enum value", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// GetEmployeeResponse has fields { string name; Mood mood; } where Mood.MOOD_HAPPY = 1.
		// The subgraph returns the bare GraphQL enum name "HAPPY".
		graphqlJSON := []byte(`{"name": "John", "mood": "HAPPY"}`)
		result, err := handler.convertGraphQLResponseToProtoJSON("test.EmployeeService", "GetEmployee", graphqlJSON)
		require.NoError(t, err)

		// The enum must be rewritten to the proto-prefixed value name so proto3-JSON parsing
		// (done by the Vanguard transcoder) maps it to the correct integer instead of dropping it.
		assert.JSONEq(t, `{
			"name": "John",
			"mood": "MOOD_HAPPY"
		}`, string(result))
	})

	t.Run("maps null enum to the proto zero value (_UNSPECIFIED)", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// A nullable GraphQL enum that resolved to null must become the proto zero value,
		// the inverse of the request path stripping *_UNSPECIFIED to "".
		graphqlJSON := []byte(`{"name": "John", "mood": null}`)
		result, err := handler.convertGraphQLResponseToProtoJSON("test.EmployeeService", "GetEmployee", graphqlJSON)
		require.NoError(t, err)

		assert.JSONEq(t, `{
			"name": "John",
			"mood": "MOOD_UNSPECIFIED"
		}`, string(result))
	})

	t.Run("re-adds prefix to repeated enum values", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// GetDocumentResponse.moods is `repeated Mood`.
		graphqlJSON := []byte(`{"name": "doc", "moods": ["HAPPY", "SAD"]}`)
		result, err := handler.convertGraphQLResponseToProtoJSON("test.EmployeeService", "GetDocument", graphqlJSON)
		require.NoError(t, err)

		assert.JSONEq(t, `{
			"name": "doc",
			"moods": ["MOOD_HAPPY", "MOOD_SAD"]
		}`, string(result))
	})

	t.Run("re-adds prefix to enum nested in a message", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// GetDocumentResponse.document is a nested Document message holding a DocumentStatus enum.
		graphqlJSON := []byte(`{"document": {"title": "spec", "status": "archived"}}`)
		result, err := handler.convertGraphQLResponseToProtoJSON("test.EmployeeService", "GetDocument", graphqlJSON)
		require.NoError(t, err)

		assert.JSONEq(t, `{
			"document": {
				"title": "spec",
				"status": "DOCUMENT_STATUS_archived"
			}
		}`, string(result))
	})

	t.Run("preserves original case of the enum value segment", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// protographic keeps the value's original case: DOCUMENT_STATUS_active, NOT
		// DOCUMENT_STATUS_ACTIVE. The descriptor-driven match must round-trip "active" exactly.
		graphqlJSON := []byte(`{"document": {"status": "active"}}`)
		result, err := handler.convertGraphQLResponseToProtoJSON("test.EmployeeService", "GetDocument", graphqlJSON)
		require.NoError(t, err)

		assert.JSONEq(t, `{
			"document": {
				"status": "DOCUMENT_STATUS_active"
			}
		}`, string(result))
	})

	t.Run("returns unknown enum value unchanged so the transcoder surfaces the error", func(t *testing.T) {
		handler := setupHandlerWithSchema(t)

		// A value with no matching proto enum is left as-is; the downstream proto3-JSON parse
		// then rejects it rather than this layer silently substituting a wrong value.
		graphqlJSON := []byte(`{"mood": "ECSTATIC"}`)
		result, err := handler.convertGraphQLResponseToProtoJSON("test.EmployeeService", "GetEmployee", graphqlJSON)
		require.NoError(t, err)

		assert.JSONEq(t, `{
			"mood": "ECSTATIC"
		}`, string(result))
	})
}
