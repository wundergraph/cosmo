package connectrpc

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
)

// errorRoundTripper simulates network/transport errors
type errorRoundTripper struct {
	err error
}

func (e *errorRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return nil, e.err
}

func TestNewRPCHandler(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("should create handler with valid config", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})

		require.NoError(t, err)
		assert.NotNil(t, handler)
		assert.Equal(t, "http://localhost:4000/graphql", handler.graphqlEndpoint)
	})

	t.Run("should add protocol to endpoint if missing", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})

		require.NoError(t, err)
		assert.Equal(t, "http://localhost:4000/graphql", handler.graphqlEndpoint)
	})

	t.Run("should return error when graphql endpoint is empty", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			HTTPClient: httpClient,
			Logger:     logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.ErrorContains(t, err, "graphql endpoint cannot be empty")
	})

	t.Run("should return error when http client is nil", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.ErrorContains(t, err, "http client cannot be nil")
	})

	t.Run("should return error when operation registry is missing", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
			HTTPClient:      httpClient,
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.ErrorContains(t, err, "operation registry is required")
	})

	t.Run("should return error when logger is nil", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
			Logger:            nil,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.ErrorContains(t, err, "logger is required")
	})
}

func TestHandleRPC(t *testing.T) {
	logger := zap.NewNop()

	// Setup operation registry with service-scoped operations
	operationRegistry := NewOperationRegistry(logger)
	operation := &schemaloader.Operation{
		Name:            "QueryGetUser",
		OperationType:   "query",
		OperationString: "query QueryGetUser($id: Int!) { getUser(id: $id) { id name } }",
	}

	// Manually add operation to registry for testing (service-scoped)
	serviceName := "user.v1.UserService"
	operationRegistry.operations = map[string]map[string]*schemaloader.Operation{
		serviceName: {
			"QueryGetUser": operation,
		},
	}

	t.Run("should successfully handle RPC request", func(t *testing.T) {
		graphqlResponse := `{"data":{"getUser":{"id":1,"name":"Jane Doe"}}}`
		httpClient := MockHTTPClient(http.StatusOK, graphqlResponse)
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		requestJSON := []byte(`{"id":1}`)
		ctx := withRequestHeaders(context.Background(), http.Header{
			"X-Custom-Header": []string{"custom-value"},
		})

		responseJSON, err := handler.HandleRPC(ctx, serviceName, "QueryGetUser", requestJSON)

		require.NoError(t, err)
		assert.NotNil(t, responseJSON)
		assert.Contains(t, string(responseJSON), "Jane Doe")
	})

	t.Run("should return error for non-existent operation", func(t *testing.T) {
		httpClient := MockHTTPClient(http.StatusOK, `{"data":{}}`)
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		requestJSON := []byte(`{"id":1}`)
		ctx := context.Background()

		_, err = handler.HandleRPC(ctx, serviceName, "NonExistentOperation", requestJSON)

		assert.Error(t, err)
		assert.ErrorContains(t, err, "operation not found")
	})
}

func TestExecuteGraphQL(t *testing.T) {
	logger := zap.NewNop()
	operationRegistry := NewOperationRegistry(logger)

	t.Run("forwarding headers from context", func(t *testing.T) {
		t.Run("should forward listed headers", func(t *testing.T) {
			// Create a test server to verify headers
			var receivedHeaders http.Header
			testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				receivedHeaders = r.Header
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"data":{}}`))
			}))
			defer testServer.Close()

			protoLoader := NewProtoLoader(logger)
			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   testServer.URL,
				HTTPClient:        &http.Client{},
				Logger:            logger,
				OperationRegistry: operationRegistry,
				ProtoLoader:       protoLoader,
			})
			require.NoError(t, err)

			ctx := withRequestHeaders(context.Background(), http.Header{
				"Authorization":  []string{"Bearer token123"},
				"X-Custom":       []string{"custom-value"},
				"Content-Length": []string{"100"}, // Should be skipped
			})

			query := "query { user { id } }"
			_, err = handler.executeGraphQL(ctx, query, nil)

			require.NoError(t, err)
			assert.Equal(t, "Bearer token123", receivedHeaders.Get("Authorization"))
			assert.Equal(t, "custom-value", receivedHeaders.Get("X-Custom"))
			// Content-Length is set by the HTTP client, not forwarded from context
			assert.Equal(t, "application/json; charset=utf-8", receivedHeaders.Get("Content-Type"))
		})
	})

	t.Run("handling HTTP transport errors", func(t *testing.T) {
		t.Run("should handle network connection error", func(t *testing.T) {
			// Create a client that simulates a network error
			httpClient := &http.Client{
				Transport: &errorRoundTripper{
					err: io.ErrUnexpectedEOF,
				},
			}

			protoLoader := NewProtoLoader(logger)
			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            logger,
				OperationRegistry: operationRegistry,
				ProtoLoader:       protoLoader,
			})
			require.NoError(t, err)

			ctx := context.Background()
			_, err = handler.executeGraphQL(ctx, "query { test }", nil)

			// Should return an error (not a Connect error, just a regular error)
			require.Error(t, err)
			assert.ErrorContains(t, err, "failed to execute HTTP request")
		})
	})
}

func TestGetOperationCount(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("should return operation count", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		// Service-scoped operations
		operationRegistry.operations = map[string]map[string]*schemaloader.Operation{
			"service1.v1.Service1": {
				"op1": {Name: "op1"},
				"op2": {Name: "op2"},
			},
			"service2.v1.Service2": {
				"op3": {Name: "op3"},
			},
		}

		protoLoader := NewProtoLoader(logger)
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		assert.Equal(t, 3, handler.GetOperationCount())
	})
}

func TestVerifyOperationExists(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("should verify operation exists", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		serviceName := "user.v1.UserService"
		operationRegistry.operations = map[string]map[string]*schemaloader.Operation{
			serviceName: {
				"QueryGetUser": {Name: "QueryGetUser"},
			},
		}

		protoLoader := NewProtoLoader(logger)
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		err = handler.VerifyOperationExists(serviceName, "QueryGetUser")
		assert.NoError(t, err)

		err = handler.VerifyOperationExists(serviceName, "NonExistent")
		assert.Error(t, err)
	})
}

func TestConvertProtoJSONToGraphQLVariables(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}
	operationRegistry := NewOperationRegistry(logger)
	protoLoader := NewProtoLoader(logger)

	handler, err := NewRPCHandler(HandlerConfig{
		GraphQLEndpoint:   "http://localhost:4000/graphql",
		HTTPClient:        httpClient,
		Logger:            logger,
		OperationRegistry: operationRegistry,
		ProtoLoader:       protoLoader,
	})
	require.NoError(t, err)

	t.Run("should convert top-level snake_case keys to camelCase", func(t *testing.T) {
		protoJSON := []byte(`{"user_id": 123, "first_name": "John"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		assert.JSONEq(t, `{"userId": 123, "firstName": "John"}`, string(result))
	})

	t.Run("should convert nested object keys recursively", func(t *testing.T) {
		protoJSON := []byte(`{
			"user_id": 123,
			"user_profile": {
				"first_name": "John",
				"last_name": "Doe",
				"contact_info": {
					"email_address": "john@example.com",
					"phone_number": "555-1234"
				}
			}
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"userId": 123,
			"userProfile": {
				"firstName": "John",
				"lastName": "Doe",
				"contactInfo": {
					"emailAddress": "john@example.com",
					"phoneNumber": "555-1234"
				}
			}
		}`
		assert.JSONEq(t, expected, string(result))
	})

	t.Run("should convert keys in arrays of objects", func(t *testing.T) {
		protoJSON := []byte(`{
			"user_list": [
				{"user_id": 1, "first_name": "Alice"},
				{"user_id": 2, "first_name": "Bob"}
			]
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"userList": [
				{"userId": 1, "firstName": "Alice"},
				{"userId": 2, "firstName": "Bob"}
			]
		}`
		assert.JSONEq(t, expected, string(result))
	})

	t.Run("should handle nested arrays with objects", func(t *testing.T) {
		protoJSON := []byte(`{
			"department_list": [
				{
					"department_name": "Engineering",
					"employee_list": [
						{"employee_id": 1, "full_name": "Alice"},
						{"employee_id": 2, "full_name": "Bob"}
					]
				}
			]
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"departmentList": [
				{
					"departmentName": "Engineering",
					"employeeList": [
						{"employeeId": 1, "fullName": "Alice"},
						{"employeeId": 2, "fullName": "Bob"}
					]
				}
			]
		}`
		assert.JSONEq(t, expected, string(result))
	})

	t.Run("should preserve primitive values in arrays", func(t *testing.T) {
		protoJSON := []byte(`{
			"tag_list": ["tag1", "tag2", "tag3"],
			"id_list": [1, 2, 3],
			"flag_list": [true, false, true]
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"tagList": ["tag1", "tag2", "tag3"],
			"idList": [1, 2, 3],
			"flagList": [true, false, true]
		}`
		assert.JSONEq(t, expected, string(result))
	})

	t.Run("should handle empty objects and arrays", func(t *testing.T) {
		protoJSON := []byte(`{
			"empty_object": {},
			"empty_array": [],
			"nested_empty": {
				"inner_empty": {}
			}
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"emptyObject": {},
			"emptyArray": [],
			"nestedEmpty": {
				"innerEmpty": {}
			}
		}`
		assert.JSONEq(t, expected, string(result))
	})

	t.Run("should handle null values", func(t *testing.T) {
		protoJSON := []byte(`{
			"user_id": 123,
			"middle_name": null,
			"optional_field": null
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"userId": 123,
			"middleName": null,
			"optionalField": null
		}`
		assert.JSONEq(t, expected, string(result))
	})

	t.Run("should handle empty JSON input", func(t *testing.T) {
		protoJSON := []byte(``)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		assert.JSONEq(t, `{}`, string(result))
	})

	t.Run("should preserve keys without underscores", func(t *testing.T) {
		protoJSON := []byte(`{
			"id": 123,
			"name": "John",
			"nested": {
				"value": "test"
			}
		}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)

		require.NoError(t, err)
		expected := `{
			"id": 123,
			"name": "John",
			"nested": {
				"value": "test"
			}
		}`
		assert.JSONEq(t, expected, string(result))
	})
}

func TestConvertKeysRecursive(t *testing.T) {
	t.Run("should convert map keys", func(t *testing.T) {
		input := map[string]any{
			"user_id":    123,
			"first_name": "John",
		}
		result := convertKeysRecursive(input)

		expected := map[string]any{
			"userId":    123,
			"firstName": "John",
		}
		assert.Equal(t, expected, result)
	})

	t.Run("should convert nested maps", func(t *testing.T) {
		input := map[string]any{
			"user_data": map[string]any{
				"first_name": "John",
				"last_name":  "Doe",
			},
		}
		result := convertKeysRecursive(input)

		expected := map[string]any{
			"userData": map[string]any{
				"firstName": "John",
				"lastName":  "Doe",
			},
		}
		assert.Equal(t, expected, result)
	})

	t.Run("should convert arrays of maps", func(t *testing.T) {
		input := []any{
			map[string]any{"user_id": 1},
			map[string]any{"user_id": 2},
		}
		result := convertKeysRecursive(input)

		expected := []any{
			map[string]any{"userId": 1},
			map[string]any{"userId": 2},
		}
		assert.Equal(t, expected, result)
	})

	t.Run("should preserve primitive values", func(t *testing.T) {
		assert.Equal(t, 123, convertKeysRecursive(123))
		assert.Equal(t, "test", convertKeysRecursive("test"))
		assert.Equal(t, true, convertKeysRecursive(true))
		assert.Equal(t, nil, convertKeysRecursive(nil))
	})
}

func TestSnakeToCamel(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"single word", "user", "user"},
		{"two words", "user_id", "userId"},
		{"three words", "first_name_last", "firstNameLast"},
		{"multiple underscores", "user__id", "userId"},
		{"trailing underscore", "user_id_", "userId"},
		{"leading underscore", "_user_id", "UserId"},
		{"all caps", "USER_ID", "USERID"},
		{"mixed case", "User_Id", "UserId"},
		{"empty string", "", ""},
		{"single underscore", "_", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := snakeToCamel(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}
