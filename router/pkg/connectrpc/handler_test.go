package connectrpc

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"go.uber.org/zap"
)

// mockHTTPClient creates a mock HTTP client that returns predefined responses
func mockHTTPClient(statusCode int, responseBody string) *http.Client {
	return &http.Client{
		Transport: &mockRoundTripper{
			statusCode:   statusCode,
			responseBody: responseBody,
		},
	}
}

type mockRoundTripper struct {
	statusCode   int
	responseBody string
}

func (m *mockRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: m.statusCode,
		Body:       io.NopCloser(strings.NewReader(m.responseBody)),
		Header:     make(http.Header),
	}, nil
}

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

	t.Run("creates handler with valid config", func(t *testing.T) {
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

	t.Run("adds protocol to endpoint if missing", func(t *testing.T) {
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

	t.Run("returns error when graphql endpoint is empty", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			HTTPClient: httpClient,
			Logger:     logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "graphql endpoint cannot be empty")
	})

	t.Run("returns error when http client is nil", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "http client cannot be nil")
	})

	t.Run("returns error when operation registry is missing", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint: "http://localhost:4000/graphql",
			HTTPClient:      httpClient,
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "operation registry is required")
	})

	t.Run("uses nop logger when logger is nil", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})

		require.NoError(t, err)
		assert.NotNil(t, handler.logger)
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

	t.Run("successfully handles RPC request", func(t *testing.T) {
		graphqlResponse := `{"data":{"getUser":{"id":1,"name":"Jane Doe"}}}`
		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)
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

	t.Run("returns error for non-existent operation", func(t *testing.T) {
		httpClient := mockHTTPClient(http.StatusOK, `{"data":{}}`)
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
		assert.Contains(t, err.Error(), "operation not found")
	})
}

// TestExecuteGraphQL_ForwardsHeadersFromContext tests that headers are properly forwarded from context
func TestExecuteGraphQL_ForwardsHeadersFromContext(t *testing.T) {
	logger := zap.NewNop()
	operationRegistry := NewOperationRegistry(logger)

	t.Run("forwards headers from context", func(t *testing.T) {
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
}

// TestExecuteGraphQL_HTTPTransportError tests handling of network/transport-level errors
func TestExecuteGraphQL_HTTPTransportError(t *testing.T) {
	logger := zap.NewNop()
	operationRegistry := NewOperationRegistry(logger)

	t.Run("handles network connection error", func(t *testing.T) {
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
		assert.Contains(t, err.Error(), "failed to execute HTTP request")
	})
}

func TestReload(t *testing.T) {
	logger := zap.NewNop()

	t.Run("reloads operations", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		httpClient := &http.Client{}

		protoLoader := NewProtoLoader(logger)
		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		// Initial count should be 0
		assert.Equal(t, 0, handler.GetOperationCount())

		// Reload should not error even with empty directory
		err = handler.Reload("")
		assert.NoError(t, err)
	})
}

func TestGetOperationCount(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("returns count", func(t *testing.T) {
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

func TestValidateOperation(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("validates operation", func(t *testing.T) {
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

		err = handler.ValidateOperation(serviceName, "QueryGetUser")
		assert.NoError(t, err)

		err = handler.ValidateOperation(serviceName, "NonExistent")
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

	t.Run("converts top-level snake_case keys to camelCase", func(t *testing.T) {
		protoJSON := []byte(`{"user_id": 123, "first_name": "John"}`)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)
		
		require.NoError(t, err)
		assert.JSONEq(t, `{"userId": 123, "firstName": "John"}`, string(result))
	})

	t.Run("converts nested object keys recursively", func(t *testing.T) {
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

	t.Run("converts keys in arrays of objects", func(t *testing.T) {
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

	t.Run("handles nested arrays with objects", func(t *testing.T) {
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

	t.Run("preserves primitive values in arrays", func(t *testing.T) {
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

	t.Run("handles empty objects and arrays", func(t *testing.T) {
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

	t.Run("handles null values", func(t *testing.T) {
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

	t.Run("handles empty JSON input", func(t *testing.T) {
		protoJSON := []byte(``)
		result, err := handler.convertProtoJSONToGraphQLVariables(protoJSON)
		
		require.NoError(t, err)
		assert.JSONEq(t, `{}`, string(result))
	})

	t.Run("preserves keys without underscores", func(t *testing.T) {
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
	t.Run("converts map keys", func(t *testing.T) {
		input := map[string]interface{}{
			"user_id":    123,
			"first_name": "John",
		}
		result := convertKeysRecursive(input)
		
		expected := map[string]interface{}{
			"userId":    123,
			"firstName": "John",
		}
		assert.Equal(t, expected, result)
	})

	t.Run("converts nested maps", func(t *testing.T) {
		input := map[string]interface{}{
			"user_data": map[string]interface{}{
				"first_name": "John",
				"last_name":  "Doe",
			},
		}
		result := convertKeysRecursive(input)
		
		expected := map[string]interface{}{
			"userData": map[string]interface{}{
				"firstName": "John",
				"lastName":  "Doe",
			},
		}
		assert.Equal(t, expected, result)
	})

	t.Run("converts arrays of maps", func(t *testing.T) {
		input := []interface{}{
			map[string]interface{}{"user_id": 1},
			map[string]interface{}{"user_id": 2},
		}
		result := convertKeysRecursive(input)
		
		expected := []interface{}{
			map[string]interface{}{"userId": 1},
			map[string]interface{}{"userId": 2},
		}
		assert.Equal(t, expected, result)
	})

	t.Run("preserves primitive values", func(t *testing.T) {
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