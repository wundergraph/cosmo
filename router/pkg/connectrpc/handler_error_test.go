package connectrpc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// TestHTTPStatusToConnectCode tests the mapping of HTTP status codes to Connect error codes
func TestHTTPStatusToConnectCode(t *testing.T) {
	tests := []struct {
		name         string
		httpStatus   int
		expectedCode connect.Code
	}{
		// 4xx Client Errors
		{"400 Bad Request", http.StatusBadRequest, connect.CodeInvalidArgument},
		{"401 Unauthorized", http.StatusUnauthorized, connect.CodeUnauthenticated},
		{"403 Forbidden", http.StatusForbidden, connect.CodePermissionDenied},
		{"404 Not Found", http.StatusNotFound, connect.CodeNotFound},
		{"408 Request Timeout", http.StatusRequestTimeout, connect.CodeDeadlineExceeded},
		{"429 Too Many Requests", http.StatusTooManyRequests, connect.CodeResourceExhausted},

		// 5xx Server Errors
		{"500 Internal Server Error", http.StatusInternalServerError, connect.CodeInternal},
		{"501 Not Implemented", http.StatusNotImplemented, connect.CodeUnimplemented},
		{"503 Service Unavailable", http.StatusServiceUnavailable, connect.CodeUnavailable},
		{"504 Gateway Timeout", http.StatusGatewayTimeout, connect.CodeDeadlineExceeded},

		// Unknown/Other
		{"418 I'm a teapot", 418, connect.CodeUnknown},
		{"599 Custom Error", 599, connect.CodeUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code := httpStatusToConnectCode(tt.httpStatus)
			assert.Equal(t, tt.expectedCode, code)
		})
	}
}

// TestExecuteGraphQL_HTTPErrors tests handling of HTTP transport errors (non-2xx status codes)
func TestExecuteGraphQL_HTTPErrors(t *testing.T) {
	tests := []struct {
		name                  string
		httpStatus            int
		responseBody          string
		expectedConnectCode   connect.Code
		expectedErrorContains string
		checkMetadata         map[string]string
	}{
		{
			name:                  "401 Unauthorized",
			httpStatus:            http.StatusUnauthorized,
			responseBody:          "Unauthorized",
			expectedConnectCode:   connect.CodeUnauthenticated,
			expectedErrorContains: "GraphQL request failed with HTTP 401",
			checkMetadata: map[string]string{
				"http-status":          "401",
				"error-classification": "CRITICAL",
			},
		},
		{
			name:                  "500 Internal Server Error",
			httpStatus:            http.StatusInternalServerError,
			responseBody:          "Internal Server Error",
			expectedConnectCode:   connect.CodeInternal,
			expectedErrorContains: "GraphQL request failed with HTTP 500",
			checkMetadata: map[string]string{
				"http-status":          "500",
				"error-classification": "CRITICAL",
			},
		},
		{
			name:                  "503 Service Unavailable",
			httpStatus:            http.StatusServiceUnavailable,
			responseBody:          "Service Unavailable",
			expectedConnectCode:   connect.CodeUnavailable,
			expectedErrorContains: "GraphQL request failed with HTTP 503",
			checkMetadata: map[string]string{
				"http-status":          "503",
				"error-classification": "CRITICAL",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup mock HTTP client
			httpClient := mockHTTPClient(tt.httpStatus, tt.responseBody)

			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            zap.NewNop(),
				OperationRegistry: NewOperationRegistry(zap.NewNop()),
			})
			require.NoError(t, err)

			// Execute
			ctx := context.Background()
			_, err = handler.executeGraphQL(ctx, "query { test }", json.RawMessage("{}"))

			// Assert error
			require.Error(t, err)

			// Check it's a Connect error
			var connectErr *connect.Error
			require.True(t, errors.As(err, &connectErr))

			// Check error code
			assert.Equal(t, tt.expectedConnectCode, connectErr.Code())

			// Check error message
			assert.Contains(t, connectErr.Message(), tt.expectedErrorContains)

			// Check metadata
			for key, expectedValue := range tt.checkMetadata {
				actualValue := connectErr.Meta().Get(key)
				assert.Equal(t, expectedValue, actualValue, "metadata key: %s", key)
			}
		})
	}
}

// TestExecuteGraphQL_CriticalErrors tests handling of GraphQL errors when no data is returned
func TestExecuteGraphQL_CriticalErrors(t *testing.T) {
	tests := []struct {
		name                  string
		graphqlResponse       string
		expectedConnectCode   connect.Code
		expectedErrorContains string
		checkMetadata         map[string]string
		expectedErrors        string
	}{
		{
			name: "Single GraphQL error with null data",
			graphqlResponse: `{
				"errors": [
					{
						"message": "Field 'user' not found",
						"path": ["user"],
						"locations": [{"line": 2, "column": 3}]
					}
				],
				"data": null
			}`,
			expectedConnectCode:   connect.CodeUnknown,
			expectedErrorContains: "GraphQL operation failed",
			checkMetadata: map[string]string{
				"error-classification": "CRITICAL",
			},
			expectedErrors: `[
				{
					"message": "Field 'user' not found",
					"path": ["user"],
					"locations": [{"line": 2, "column": 3}]
				}
			]`,
		},
		{
			name: "Multiple GraphQL errors with no data",
			graphqlResponse: `{
				"errors": [
					{
						"message": "Authentication required",
						"extensions": {"code": "UNAUTHENTICATED"}
					},
					{
						"message": "Invalid token",
						"extensions": {"code": "INVALID_TOKEN"}
					}
				],
				"data": null
			}`,
			expectedConnectCode:   connect.CodeUnknown,
			expectedErrorContains: "GraphQL operation failed",
			checkMetadata: map[string]string{
				"error-classification": "CRITICAL",
			},
			expectedErrors: `[
				{
					"message": "Authentication required",
					"extensions": {"code": "UNAUTHENTICATED"}
				},
				{
					"message": "Invalid token",
					"extensions": {"code": "INVALID_TOKEN"}
				}
			]`,
		},
		{
			name: "GraphQL error with empty data object",
			graphqlResponse: `{
				"errors": [
					{
						"message": "Query validation failed"
					}
				]
			}`,
			expectedConnectCode:   connect.CodeUnknown,
			expectedErrorContains: "GraphQL operation failed",
			checkMetadata: map[string]string{
				"error-classification": "CRITICAL",
			},
			expectedErrors: `[
				{
					"message": "Query validation failed"
				}
			]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			httpClient := mockHTTPClient(http.StatusOK, tt.graphqlResponse)

			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            zap.NewNop(),
				OperationRegistry: NewOperationRegistry(zap.NewNop()),
			})
			require.NoError(t, err)

			ctx := context.Background()
			_, err = handler.executeGraphQL(ctx, "query { test }", json.RawMessage("{}"))

			require.Error(t, err)

			var connectErr *connect.Error
			require.True(t, errors.As(err, &connectErr))

			assert.Equal(t, tt.expectedConnectCode, connectErr.Code())
			assert.Contains(t, connectErr.Message(), tt.expectedErrorContains)

			for key, expectedValue := range tt.checkMetadata {
				actualValue := connectErr.Meta().Get(key)
				assert.Equal(t, expectedValue, actualValue, "metadata key: %s", key)
			}

			errorsJSON := connectErr.Meta().Get("graphql-errors")
			require.NotEmpty(t, errorsJSON)
			require.JSONEq(t, tt.expectedErrors, errorsJSON, "GraphQL errors should match snapshot")
		})
	}
}

// TestExecuteGraphQL_NonCriticalErrors_PartialData tests handling of GraphQL errors with partial data
func TestExecuteGraphQL_NonCriticalErrors_PartialData(t *testing.T) {
	tests := []struct {
		name                  string
		graphqlResponse       string
		expectedConnectCode   connect.Code
		expectedErrorContains string
		checkMetadata         map[string]string
		expectedPartialData   string
		expectedErrors        string
	}{
		{
			name: "Partial success - some fields succeeded, some failed",
			graphqlResponse: `{
				"data": {
					"user": {
						"id": "123",
						"name": "John Doe",
						"email": null
					}
				},
				"errors": [
					{
						"message": "Email field requires authentication",
						"path": ["user", "email"],
						"extensions": {"code": "FORBIDDEN"}
					}
				]
			}`,
			expectedConnectCode:   connect.CodeUnknown,
			expectedErrorContains: "GraphQL partial success with errors",
			checkMetadata: map[string]string{
				"error-classification": "NON-CRITICAL",
			},
			expectedPartialData: `{
				"user": {
					"id": "123",
					"name": "John Doe",
					"email": null
				}
			}`,
			expectedErrors: `[
				{
					"message": "Email field requires authentication",
					"path": ["user", "email"],
					"extensions": {"code": "FORBIDDEN"}
				}
			]`,
		},
		{
			name: "Multiple field errors with partial data",
			graphqlResponse: `{
				"data": {
					"posts": [
						{"id": "1", "title": "Post 1"},
						null,
						{"id": "3", "title": "Post 3"}
					]
				},
				"errors": [
					{
						"message": "Post not found",
						"path": ["posts", 1]
					},
					{
						"message": "Access denied",
						"path": ["posts", 1, "author"]
					}
				]
			}`,
			expectedConnectCode:   connect.CodeUnknown,
			expectedErrorContains: "GraphQL partial success with errors",
			checkMetadata: map[string]string{
				"error-classification": "NON-CRITICAL",
			},
			expectedPartialData: `{
				"posts": [
					{"id": "1", "title": "Post 1"},
					null,
					{"id": "3", "title": "Post 3"}
				]
			}`,
			expectedErrors: `[
				{
					"message": "Post not found",
					"path": ["posts", 1]
				},
				{
					"message": "Access denied",
					"path": ["posts", 1, "author"]
				}
			]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup mock HTTP client
			httpClient := mockHTTPClient(http.StatusOK, tt.graphqlResponse)

			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            zap.NewNop(),
				OperationRegistry: NewOperationRegistry(zap.NewNop()),
			})
			require.NoError(t, err)

			// Execute
			ctx := context.Background()
			_, err = handler.executeGraphQL(ctx, "query { test }", json.RawMessage("{}"))

			// Assert error (even with partial data, we return an error)
			require.Error(t, err)

			// Check it's a Connect error
			var connectErr *connect.Error
			require.True(t, errors.As(err, &connectErr))

			// Check error code
			assert.Equal(t, tt.expectedConnectCode, connectErr.Code())

			// Check error message
			assert.Contains(t, connectErr.Message(), tt.expectedErrorContains)

			// Check metadata
			for key, expectedValue := range tt.checkMetadata {
				actualValue := connectErr.Meta().Get(key)
				assert.Equal(t, expectedValue, actualValue, "metadata key: %s", key)
			}

			partialData := connectErr.Meta().Get("graphql-partial-data")
			require.NotEmpty(t, partialData)
			require.JSONEq(t, tt.expectedPartialData, partialData, "Partial data should match snapshot")

			errorsJSON := connectErr.Meta().Get("graphql-errors")
			require.NotEmpty(t, errorsJSON)
			require.JSONEq(t, tt.expectedErrors, errorsJSON, "GraphQL errors should match snapshot")
		})
	}
}

// TestExecuteGraphQL_Success tests successful GraphQL responses with data and no errors
func TestExecuteGraphQL_Success(t *testing.T) {
	tests := []struct {
		name            string
		graphqlResponse string
		expectedData    string
	}{
		{
			name: "Simple successful query",
			graphqlResponse: `{
				"data": {
					"user": {
						"id": "123",
						"name": "John Doe"
					}
				}
			}`,
			expectedData: `{
				"user": {
					"id": "123",
					"name": "John Doe"
				}
			}`,
		},
		{
			name: "Successful query with nested data",
			graphqlResponse: `{
				"data": {
					"users": [
						{"id": "1", "name": "Alice"},
						{"id": "2", "name": "Bob"}
					]
				}
			}`,
			expectedData: `{
				"users": [
					{"id": "1", "name": "Alice"},
					{"id": "2", "name": "Bob"}
				]
			}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Setup mock HTTP client
			httpClient := mockHTTPClient(http.StatusOK, tt.graphqlResponse)

			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            zap.NewNop(),
				OperationRegistry: NewOperationRegistry(zap.NewNop()),
			})
			require.NoError(t, err)

			// Execute
			ctx := context.Background()
			data, err := handler.executeGraphQL(ctx, "query { test }", json.RawMessage("{}"))

			// Assert success
			require.NoError(t, err)
			require.NotNil(t, data)

			// Check data content using helper for exact JSON equality
			require.JSONEq(t, tt.expectedData, string(data), "Partial data should match expected structure")
		})
	}
}

// TestErrorMetadata_Structure tests that error metadata is properly structured
func TestErrorMetadata_Structure(t *testing.T) {
	t.Run("CRITICAL error metadata structure", func(t *testing.T) {
		graphqlResponse := `{
			"errors": [
				{
					"message": "Test error",
					"path": ["user", "email"],
					"locations": [{"line": 2, "column": 5}],
					"extensions": {"code": "TEST_ERROR"}
				}
			],
			"data": null
		}`

		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)
		handler, _ := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            zap.NewNop(),
			OperationRegistry: NewOperationRegistry(zap.NewNop()),
		})

		_, err := handler.executeGraphQL(context.Background(), "query { test }", json.RawMessage("{}"))

		var connectErr *connect.Error
		require.True(t, errors.As(err, &connectErr))

		// Verify metadata structure
		assert.Equal(t, "CRITICAL", connectErr.Meta().Get("error-classification"))

		// Parse and verify GraphQL errors JSON using inline snapshot
		errorsJSON := connectErr.Meta().Get("graphql-errors")
		
		// Expected structure as inline snapshot (pretty-printed for readability)
		expectedErrorsJSON := `[
		{
		  "message": "Test error",
		  "path": ["user", "email"],
		  "locations": [{"line": 2, "column": 5}],
		  "extensions": {"code": "TEST_ERROR"}
		}
]`
		
		// Use testify's JSONEq for semantic JSON comparison
		require.JSONEq(t, expectedErrorsJSON, errorsJSON, "GraphQL errors structure should match snapshot")
	})

	t.Run("NON-CRITICAL error metadata structure", func(t *testing.T) {
		graphqlResponse := `{
			"data": {"user": {"id": "123"}},
			"errors": [{"message": "Partial error"}]
		}`

		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)
		handler, _ := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            zap.NewNop(),
			OperationRegistry: NewOperationRegistry(zap.NewNop()),
		})

		_, err := handler.executeGraphQL(context.Background(), "query { test }", json.RawMessage("{}"))

		var connectErr *connect.Error
		require.True(t, errors.As(err, &connectErr))

		// Verify metadata structure
		assert.Equal(t, "NON-CRITICAL", connectErr.Meta().Get("error-classification"))
		
		// Verify partial data using inline snapshot (pretty-printed for readability)
		partialData := connectErr.Meta().Get("graphql-partial-data")
		expectedPartialData := `{
		"user": {
		  "id": "123"
		}
}`
		
		// Use testify's JSONEq for semantic JSON comparison
		require.JSONEq(t, expectedPartialData, partialData, "Partial data should match snapshot")
		
		// Verify GraphQL errors using inline snapshot
		errorsJSON := connectErr.Meta().Get("graphql-errors")
		expectedErrors := `[
		{
		  "message": "Partial error"
		}
]`
		require.JSONEq(t, expectedErrors, errorsJSON, "GraphQL errors should match snapshot")
	})
}