package connectrpc

import (
	"context"
	"encoding/json"
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

func TestNewRPCHandler(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("creates handler with valid config", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})

		require.NoError(t, err)
		assert.NotNil(t, handler)
		assert.Equal(t, "http://localhost:4000/graphql", handler.graphqlEndpoint)
	})

	t.Run("adds protocol to endpoint if missing", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
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

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			OperationRegistry: operationRegistry,
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

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
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

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		requestJSON := []byte(`{"id":1}`)
		ctx := context.Background()

		_, err = handler.HandleRPC(ctx, serviceName, "NonExistentOperation", requestJSON)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "operation not found")
	})
}

func TestExecuteGraphQL(t *testing.T) {
	logger := zap.NewNop()
	operationRegistry := NewOperationRegistry(logger)

	t.Run("successfully executes GraphQL query", func(t *testing.T) {
		graphqlResponse := `{"data":{"user":{"id":1,"name":"Test User"}}}`
		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		query := "query { user { id name } }"
		variables := json.RawMessage(`{"id":1}`)
		ctx := context.Background()

		responseJSON, err := handler.executeGraphQL(ctx, query, variables)

		require.NoError(t, err)
		assert.Contains(t, string(responseJSON), "Test User")
	})

	t.Run("handles GraphQL errors gracefully", func(t *testing.T) {
		graphqlResponse := `{"errors":[{"message":"User not found"}],"data":null}`
		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		query := "query { user { id name } }"
		variables := json.RawMessage(`{"id":999}`)
		ctx := context.Background()

		responseJSON, err := handler.executeGraphQL(ctx, query, variables)

		require.NoError(t, err)
		assert.Contains(t, string(responseJSON), "User not found")
	})

	t.Run("returns error for HTTP errors", func(t *testing.T) {
		httpClient := mockHTTPClient(http.StatusInternalServerError, "Internal Server Error")

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		query := "query { user { id name } }"
		variables := json.RawMessage(`{"id":1}`)
		ctx := context.Background()

		_, err = handler.executeGraphQL(ctx, query, variables)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "GraphQL request failed with status 500")
	})

	t.Run("forwards headers from context", func(t *testing.T) {
		// Create a test server to verify headers
		var receivedHeaders http.Header
		testServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			receivedHeaders = r.Header
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{}}`))
		}))
		defer testServer.Close()

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   testServer.URL,
			HTTPClient:        &http.Client{},
			Logger:            logger,
			OperationRegistry: operationRegistry,
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

func TestReload(t *testing.T) {
	logger := zap.NewNop()

	t.Run("reloads operations", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		httpClient := &http.Client{}

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
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

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
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

		handler, err := NewRPCHandler(HandlerConfig{
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		err = handler.ValidateOperation(serviceName, "QueryGetUser")
		assert.NoError(t, err)

		err = handler.ValidateOperation(serviceName, "NonExistent")
		assert.Error(t, err)
	})
}