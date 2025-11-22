package connectrpc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
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

	t.Run("creates handler with valid dynamic mode config", func(t *testing.T) {
		protoLoader := NewProtoLoader(logger)
		operationBuilder := NewOperationBuilder()
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})

		require.NoError(t, err)
		assert.NotNil(t, handler)
		assert.Equal(t, HandlerModeDynamic, handler.mode)
		assert.Equal(t, "http://localhost:4000/graphql", handler.graphqlEndpoint)
	})

	t.Run("creates handler with valid predefined mode config", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})

		require.NoError(t, err)
		assert.NotNil(t, handler)
		assert.Equal(t, HandlerModePredefined, handler.mode)
	})

	t.Run("adds protocol to endpoint if missing", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
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
			Mode:       HandlerModeDynamic,
			HTTPClient: httpClient,
			Logger:     logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "graphql endpoint cannot be empty")
	})

	t.Run("returns error when http client is nil", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			Mode:            HandlerModeDynamic,
			GraphQLEndpoint: "http://localhost:4000/graphql",
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "http client cannot be nil")
	})

	t.Run("returns error when operation builder is missing in dynamic mode", func(t *testing.T) {
		protoLoader := NewProtoLoader(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:            HandlerModeDynamic,
			GraphQLEndpoint: "http://localhost:4000/graphql",
			HTTPClient:      httpClient,
			Logger:          logger,
			ProtoLoader:     protoLoader,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "operation builder is required")
	})

	t.Run("returns error when proto loader is missing in dynamic mode", func(t *testing.T) {
		operationBuilder := NewOperationBuilder()

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:             HandlerModeDynamic,
			GraphQLEndpoint:  "http://localhost:4000/graphql",
			HTTPClient:       httpClient,
			Logger:           logger,
			OperationBuilder: operationBuilder,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "proto loader is required")
	})

	t.Run("returns error when operation registry is missing in predefined mode", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			Mode:            HandlerModePredefined,
			GraphQLEndpoint: "http://localhost:4000/graphql",
			HTTPClient:      httpClient,
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "operation registry is required")
	})

	t.Run("returns error for invalid mode", func(t *testing.T) {
		handler, err := NewRPCHandler(HandlerConfig{
			Mode:            "invalid",
			GraphQLEndpoint: "http://localhost:4000/graphql",
			HTTPClient:      httpClient,
			Logger:          logger,
		})

		assert.Error(t, err)
		assert.Nil(t, handler)
		assert.Contains(t, err.Error(), "invalid handler mode")
	})

	t.Run("uses nop logger when logger is nil", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			OperationRegistry: operationRegistry,
		})

		require.NoError(t, err)
		assert.NotNil(t, handler.logger)
	})
}

func TestHandleRPC_DynamicMode(t *testing.T) {
	logger := zap.NewNop()

	// Create a test proto file
	protoContent := `
syntax = "proto3";
package test;

message GetUserRequest {
	int32 id = 1;
}

message User {
	int32 id = 1;
	string name = 2;
}

service UserService {
	rpc QueryGetUser(GetUserRequest) returns (User);
}
`

	// Setup proto loader
	protoLoader := setupTestProtoLoader(t, protoContent)
	operationBuilder := NewOperationBuilder()

	t.Run("successfully handles RPC request", func(t *testing.T) {
		// Mock GraphQL response
		graphqlResponse := `{"data":{"getUser":{"id":1,"name":"John Doe"}}}`
		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)
		operationRegistry := NewOperationRegistry(logger)
		
		// Pre-populate registry with operations
		populateOperationRegistry(t, operationRegistry, protoLoader, operationBuilder)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		// Create request JSON
		requestJSON := []byte(`{"id":1}`)

		// Create context with headers
		ctx := withRequestHeaders(context.Background(), http.Header{
			"Authorization": []string{"Bearer token123"},
		})

		// Handle RPC
		responseJSON, err := handler.HandleRPC(ctx, "test.UserService", "QueryGetUser", requestJSON)

		require.NoError(t, err)
		assert.NotNil(t, responseJSON)
		assert.Contains(t, string(responseJSON), "John Doe")
	})

	t.Run("returns error for non-existent service/method combination", func(t *testing.T) {
		httpClient := mockHTTPClient(http.StatusOK, `{"data":{}}`)
		operationRegistry := NewOperationRegistry(logger)
		
		// Pre-populate registry with operations
		populateOperationRegistry(t, operationRegistry, protoLoader, operationBuilder)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		requestJSON := []byte(`{"id":1}`)
		ctx := context.Background()

		// In the new architecture, the service name is not validated separately
		// The operation lookup is by method name only, so use a non-existent method
		_, err = handler.HandleRPC(ctx, "test.NonExistentService", "QueryNonExistentMethod", requestJSON)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "operation not found in registry")
	})

	t.Run("returns error for non-existent method", func(t *testing.T) {
		httpClient := mockHTTPClient(http.StatusOK, `{"data":{}}`)
		operationRegistry := NewOperationRegistry(logger)
		
		// Pre-populate registry with operations
		populateOperationRegistry(t, operationRegistry, protoLoader, operationBuilder)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		requestJSON := []byte(`{"id":1}`)
		ctx := context.Background()

		_, err = handler.HandleRPC(ctx, "test.UserService", "NonExistentMethod", requestJSON)

		assert.Error(t, err)
		assert.Contains(t, err.Error(), "operation not found in registry")
	})
}

func TestHandleRPC_PredefinedMode(t *testing.T) {
	logger := zap.NewNop()

	// Setup operation registry
	operationRegistry := NewOperationRegistry(logger)
	operation := &schemaloader.Operation{
		Name:            "QueryGetUser",
		OperationType:   "query",
		OperationString: "query QueryGetUser($id: Int!) { getUser(id: $id) { id name } }",
	}

	// Manually add operation to registry for testing
	operationRegistry.operations = map[string]*schemaloader.Operation{
		"QueryGetUser": operation,
	}

	t.Run("successfully handles RPC request", func(t *testing.T) {
		graphqlResponse := `{"data":{"getUser":{"id":1,"name":"Jane Doe"}}}`
		httpClient := mockHTTPClient(http.StatusOK, graphqlResponse)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
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

		responseJSON, err := handler.HandleRPC(ctx, "", "QueryGetUser", requestJSON)

		require.NoError(t, err)
		assert.NotNil(t, responseJSON)
		assert.Contains(t, string(responseJSON), "Jane Doe")
	})

	t.Run("returns error for non-existent operation", func(t *testing.T) {
		httpClient := mockHTTPClient(http.StatusOK, `{"data":{}}`)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		requestJSON := []byte(`{"id":1}`)
		ctx := context.Background()

		_, err = handler.HandleRPC(ctx, "", "NonExistentOperation", requestJSON)

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
			Mode:              HandlerModePredefined,
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
			Mode:              HandlerModePredefined,
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
			Mode:              HandlerModePredefined,
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
			Mode:              HandlerModePredefined,
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

	t.Run("reloads operations in predefined mode", func(t *testing.T) {
		schemaDoc := parseTestSchema(t, `
			type Query {
				getUser(id: Int!): User
			}
			type User {
				id: Int!
				name: String!
			}
		`)

		operationRegistry := NewOperationRegistry(logger)
		httpClient := &http.Client{}

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		// Initial count should be 0
		assert.Equal(t, 0, handler.GetOperationCount())

		// Reload should not error even with empty directory
		err = handler.Reload(schemaDoc, "")
		assert.NoError(t, err)
	})

	t.Run("does nothing in dynamic mode", func(t *testing.T) {
		protoLoader := NewProtoLoader(logger)
		operationBuilder := NewOperationBuilder()
		operationRegistry := NewOperationRegistry(logger)
		httpClient := &http.Client{}

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		err = handler.Reload(nil, "")
		assert.NoError(t, err)
	})
}

func TestGetMode(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("returns dynamic mode", func(t *testing.T) {
		protoLoader := NewProtoLoader(logger)
		operationBuilder := NewOperationBuilder()
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		assert.Equal(t, HandlerModeDynamic, handler.GetMode())
	})

	t.Run("returns predefined mode", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		assert.Equal(t, HandlerModePredefined, handler.GetMode())
	})
}

func TestGetOperationCount(t *testing.T) {
	logger := zap.NewNop()
	httpClient := &http.Client{}

	t.Run("returns count for dynamic mode", func(t *testing.T) {
		protoContent := `
syntax = "proto3";
package test;

message Request {}
message Response {}

service TestService {
	rpc QueryMethod1(Request) returns (Response);
	rpc QueryMethod2(Request) returns (Response);
}
`
		protoLoader := setupTestProtoLoader(t, protoContent)
		operationBuilder := NewOperationBuilder()
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		assert.Equal(t, 2, handler.GetOperationCount())
	})

	t.Run("returns count for predefined mode", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		operationRegistry.operations = map[string]*schemaloader.Operation{
			"op1": {Name: "op1"},
			"op2": {Name: "op2"},
			"op3": {Name: "op3"},
		}

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
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

	t.Run("validates operation in dynamic mode", func(t *testing.T) {
		protoContent := `
syntax = "proto3";
package test;

message Request {}
message Response {}

service TestService {
	rpc QueryMethod(Request) returns (Response);
}
`
		protoLoader := setupTestProtoLoader(t, protoContent)
		operationBuilder := NewOperationBuilder()
		operationRegistry := NewOperationRegistry(logger)

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModeDynamic,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationBuilder:  operationBuilder,
			OperationRegistry: operationRegistry,
			ProtoLoader:       protoLoader,
		})
		require.NoError(t, err)

		err = handler.ValidateOperation("test.TestService", "QueryMethod")
		assert.NoError(t, err)

		err = handler.ValidateOperation("test.TestService", "NonExistent")
		assert.Error(t, err)
	})

	t.Run("validates operation in predefined mode", func(t *testing.T) {
		operationRegistry := NewOperationRegistry(logger)
		operationRegistry.operations = map[string]*schemaloader.Operation{
			"QueryGetUser": {Name: "QueryGetUser"},
		}

		handler, err := NewRPCHandler(HandlerConfig{
			Mode:              HandlerModePredefined,
			GraphQLEndpoint:   "http://localhost:4000/graphql",
			HTTPClient:        httpClient,
			Logger:            logger,
			OperationRegistry: operationRegistry,
		})
		require.NoError(t, err)

		err = handler.ValidateOperation("", "QueryGetUser")
		assert.NoError(t, err)

		err = handler.ValidateOperation("", "NonExistent")
		assert.Error(t, err)
	})
}

// Helper functions

func setupTestProtoLoader(t *testing.T, protoContent string) *ProtoLoader {
	t.Helper()

	// Create temporary directory for proto file
	tmpDir := t.TempDir()
	protoFile := tmpDir + "/test.proto"

	err := os.WriteFile(protoFile, []byte(protoContent), 0644)
	require.NoError(t, err)

	// Load proto file
	protoLoader := NewProtoLoader(zap.NewNop())
	err = protoLoader.LoadFromDirectory(tmpDir)
	require.NoError(t, err)

	return protoLoader
}

// populateOperationRegistry pre-generates operations for dynamic mode testing
func populateOperationRegistry(t *testing.T, registry *OperationRegistry, protoLoader *ProtoLoader, builder *OperationBuilder) {
	t.Helper()

	services := protoLoader.GetServices()
	for _, service := range services {
		for _, method := range service.Methods {
			graphqlQuery, err := builder.BuildOperation(&method)
			require.NoError(t, err)

			opType := "query"
			if strings.HasPrefix(method.Name, "Mutation") {
				opType = "mutation"
			}

			registry.AddOperation(&schemaloader.Operation{
				Name:            method.Name,
				OperationType:   opType,
				OperationString: graphqlQuery,
			})
		}
	}
}

func parseTestSchema(t *testing.T, schemaSDL string) *ast.Document {
	t.Helper()

	doc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
	require.False(t, report.HasErrors(), "schema parsing failed: %v", report)

	return &doc
}