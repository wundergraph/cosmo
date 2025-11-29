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

// errorTestCase defines a test case for error handling
type errorTestCase struct {
	name                  string
	httpStatus            int
	graphqlResponse       string
	expectedConnectCode   connect.Code
	expectedErrorContains string
	expectedMetadata      map[string]string
	expectedGraphQLErrors string // JSON string for GraphQL errors
	expectedPartialData   string // JSON string for partial data
}

// TestHTTPStatusToConnectCode tests the mapping of HTTP status codes to Connect error codes
func TestHTTPStatusToConnectCode(t *testing.T) {
	t.Parallel()

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

// TestErrorHandling consolidates all error handling tests with shared setup
func TestErrorHandling(t *testing.T) {
	t.Parallel()

	tests := []errorTestCase{
		// HTTP Transport Errors
		{
			name:                  "HTTP 401 Unauthorized",
			httpStatus:            http.StatusUnauthorized,
			graphqlResponse:       "Unauthorized",
			expectedConnectCode:   connect.CodeUnauthenticated,
			expectedErrorContains: "GraphQL request failed with HTTP 401",
			expectedMetadata: map[string]string{
				MetaKeyHTTPStatus:          "401",
				MetaKeyErrorClassification: ErrorClassificationCritical,
			},
		},
		{
			name:                  "HTTP 500 Internal Server Error",
			httpStatus:            http.StatusInternalServerError,
			graphqlResponse:       "Internal Server Error",
			expectedConnectCode:   connect.CodeInternal,
			expectedErrorContains: "GraphQL request failed with HTTP 500",
			expectedMetadata: map[string]string{
				MetaKeyHTTPStatus:          "500",
				MetaKeyErrorClassification: ErrorClassificationCritical,
			},
		},
		{
			name:                  "HTTP 503 Service Unavailable",
			httpStatus:            http.StatusServiceUnavailable,
			graphqlResponse:       "Service Unavailable",
			expectedConnectCode:   connect.CodeUnavailable,
			expectedErrorContains: "GraphQL request failed with HTTP 503",
			expectedMetadata: map[string]string{
				MetaKeyHTTPStatus:          "503",
				MetaKeyErrorClassification: ErrorClassificationCritical,
			},
		},

		// GraphQL CRITICAL Errors (no data)
		{
			name:       "GraphQL error with null data",
			httpStatus: http.StatusOK,
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
			expectedMetadata: map[string]string{
				MetaKeyErrorClassification: ErrorClassificationCritical,
			},
			expectedGraphQLErrors: `[
				{
					"message": "Field 'user' not found",
					"path": ["user"],
					"locations": [{"line": 2, "column": 3}]
				}
			]`,
		},
		{
			name:       "Multiple GraphQL errors with no data",
			httpStatus: http.StatusOK,
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
			expectedMetadata: map[string]string{
				MetaKeyErrorClassification: ErrorClassificationCritical,
			},
			expectedGraphQLErrors: `[
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

		// GraphQL NON-CRITICAL Errors (with partial data)
		{
			name:       "Partial success - some fields succeeded, some failed",
			httpStatus: http.StatusOK,
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
			expectedMetadata: map[string]string{
				MetaKeyErrorClassification: ErrorClassificationNonCritical,
			},
			expectedPartialData: `{
				"user": {
					"id": "123",
					"name": "John Doe",
					"email": null
				}
			}`,
			expectedGraphQLErrors: `[
				{
					"message": "Email field requires authentication",
					"path": ["user", "email"],
					"extensions": {"code": "FORBIDDEN"}
				}
			]`,
		},
		{
			name:       "Multiple field errors with partial data",
			httpStatus: http.StatusOK,
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
			expectedMetadata: map[string]string{
				MetaKeyErrorClassification: ErrorClassificationNonCritical,
			},
			expectedPartialData: `{
				"posts": [
					{"id": "1", "title": "Post 1"},
					null,
					{"id": "3", "title": "Post 3"}
				]
			}`,
			expectedGraphQLErrors: `[
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
			httpClient := MockHTTPClient(tt.httpStatus, tt.graphqlResponse)

			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            zap.NewNop(),
				OperationRegistry: NewOperationRegistry(zap.NewNop()),
				ProtoLoader:       NewProtoLoader(zap.NewNop()),
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
			for key, expectedValue := range tt.expectedMetadata {
				actualValue := connectErr.Meta().Get(key)
				assert.Equal(t, expectedValue, actualValue, "metadata key: %s", key)
			}

			// Check GraphQL errors if expected
			if tt.expectedGraphQLErrors != "" {
				errorsJSON := connectErr.Meta().Get(MetaKeyGraphQLErrors)
				require.NotEmpty(t, errorsJSON)
				require.JSONEq(t, tt.expectedGraphQLErrors, errorsJSON, "GraphQL errors should match")
			}

			// Check partial data if expected
			if tt.expectedPartialData != "" {
				partialData := connectErr.Meta().Get(MetaKeyGraphQLPartialData)
				require.NotEmpty(t, partialData)
				require.JSONEq(t, tt.expectedPartialData, partialData, "Partial data should match")
			}
		})
	}
}

// TestSuccessfulGraphQLResponses tests successful GraphQL responses
func TestSuccessfulGraphQLResponses(t *testing.T) {
	t.Parallel()

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
			httpClient := MockHTTPClient(http.StatusOK, tt.graphqlResponse)

			handler, err := NewRPCHandler(HandlerConfig{
				GraphQLEndpoint:   "http://localhost:4000/graphql",
				HTTPClient:        httpClient,
				Logger:            zap.NewNop(),
				OperationRegistry: NewOperationRegistry(zap.NewNop()),
				ProtoLoader:       NewProtoLoader(zap.NewNop()),
			})
			require.NoError(t, err)

			// Execute
			ctx := context.Background()
			data, err := handler.executeGraphQL(ctx, "query { test }", json.RawMessage("{}"))

			// Assert success
			require.NoError(t, err)
			require.NotNil(t, data)

			// Check data content
			require.JSONEq(t, tt.expectedData, string(data))
		})
	}
}