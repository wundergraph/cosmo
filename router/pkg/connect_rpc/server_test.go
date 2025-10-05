package connect_rpc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"go.uber.org/zap"
)

func TestNewConnectRPCServer(t *testing.T) {
	tests := []struct {
		name                  string
		routerGraphQLEndpoint string
		options               []func(*Options)
		expectError           bool
	}{
		{
			name:                  "valid endpoint",
			routerGraphQLEndpoint: "http://localhost:4000/graphql",
			expectError:           false,
		},
		{
			name:                  "endpoint without protocol",
			routerGraphQLEndpoint: "localhost:4000/graphql",
			expectError:           false,
		},
		{
			name:                  "empty endpoint",
			routerGraphQLEndpoint: "",
			expectError:           true,
		},
		{
			name:                  "with custom options",
			routerGraphQLEndpoint: "http://localhost:4000/graphql",
			options: []func(*Options){
				WithListenAddr("0.0.0.0:8080"),
				WithOperationsDir("custom-operations"),
				WithProtoDir("custom-proto"),
				WithExcludeMutations(true),
			},
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server, err := NewConnectRPCServer(tt.routerGraphQLEndpoint, tt.options...)
			
			if tt.expectError {
				assert.Error(t, err)
				assert.Nil(t, server)
			} else {
				assert.NoError(t, err)
				assert.NotNil(t, server)
				
				if len(tt.options) > 0 {
					assert.Equal(t, "0.0.0.0:8080", server.listenAddr)
					assert.Equal(t, "custom-operations", server.operationsDir)
					assert.Equal(t, "custom-proto", server.protoDir)
					assert.True(t, server.excludeMutations)
				}
			}
		})
	}
}

func TestConnectRPCServer_ExtractMethodName(t *testing.T) {
	server := &ConnectRPCServer{}

	tests := []struct {
		name      string
		procedure string
		expected  string
		expectErr bool
	}{
		{
			name:      "valid procedure",
			procedure: "/service.v1.EmployeeService/GetEmployeeByID",
			expected:  "GetEmployeeByID",
			expectErr: false,
		},
		{
			name:      "another valid procedure",
			procedure: "/api.v2.UserService/CreateUser",
			expected:  "CreateUser",
			expectErr: false,
		},
		{
			name:      "invalid procedure format",
			procedure: "/invalid",
			expected:  "",
			expectErr: true,
		},
		{
			name:      "empty procedure",
			procedure: "",
			expected:  "",
			expectErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create a mock request with the procedure
			req := &connect.Request[json.RawMessage]{}
			req.Spec().Procedure = tt.procedure

			result, err := server.extractMethodName(req)

			if tt.expectErr {
				assert.Error(t, err)
				assert.Empty(t, result)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.expected, result)
			}
		})
	}
}

func TestConnectRPCServer_ExecuteGraphQLQuery(t *testing.T) {
	// Create a mock GraphQL server
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "POST", r.Method)
		assert.Equal(t, "application/json; charset=utf-8", r.Header.Get("Content-Type"))

		var req struct {
			Query     string          `json:"query"`
			Variables json.RawMessage `json:"variables"`
		}
		
		err := json.NewDecoder(r.Body).Decode(&req)
		require.NoError(t, err)

		// Mock response
		response := map[string]interface{}{
			"data": map[string]interface{}{
				"employee": map[string]interface{}{
					"id":   1,
					"name": "John Doe",
				},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer mockServer.Close()

	server, err := NewConnectRPCServer(mockServer.URL)
	require.NoError(t, err)

	ctx := context.Background()
	query := `query GetEmployee($id: ID!) { employee(id: $id) { id name } }`
	variables := json.RawMessage(`{"id": "1"}`)

	result, err := server.executeGraphQLQuery(ctx, query, variables)
	assert.NoError(t, err)
	assert.NotEmpty(t, result)

	// Verify the result contains expected data
	var response map[string]interface{}
	err = json.Unmarshal(result, &response)
	require.NoError(t, err)
	
	data, ok := response["data"].(map[string]interface{})
	require.True(t, ok)
	
	employee, ok := data["employee"].(map[string]interface{})
	require.True(t, ok)
	
	assert.Equal(t, float64(1), employee["id"])
	assert.Equal(t, "John Doe", employee["name"])
}

func TestConnectRPCServer_ExecuteGraphQLQueryWithErrors(t *testing.T) {
	// Create a mock GraphQL server that returns errors
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"errors": []map[string]interface{}{
				{"message": "Field 'employee' not found"},
				{"message": "Invalid argument"},
			},
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer mockServer.Close()

	server, err := NewConnectRPCServer(mockServer.URL)
	require.NoError(t, err)

	ctx := context.Background()
	query := `query GetEmployee($id: ID!) { employee(id: $id) { id name } }`
	variables := json.RawMessage(`{"id": "1"}`)

	result, err := server.executeGraphQLQuery(ctx, query, variables)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "GraphQL errors")
	assert.Contains(t, err.Error(), "Field 'employee' not found")
	assert.Contains(t, err.Error(), "Invalid argument")
	assert.Empty(t, result)
}

func TestConnectRPCServer_HandleConnectRPCRequest(t *testing.T) {
	// Create a mock GraphQL server
	mockGraphQLServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := map[string]interface{}{
			"data": map[string]interface{}{
				"employee": map[string]interface{}{
					"id":   1,
					"name": "John Doe",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	}))
	defer mockGraphQLServer.Close()

	// Create server with mock operations manager
	server, err := NewConnectRPCServer(mockGraphQLServer.URL, WithLogger(zap.NewNop()))
	require.NoError(t, err)

	// Create a mock schema
	schemaSDL := `
		type Query {
			employee(id: ID!): Employee
		}
		type Employee {
			id: ID!
			name: String!
		}
	`
	
	doc, report := astparser.ParseGraphqlDocumentString(schemaSDL)
	require.False(t, report.HasErrors())

	// Initialize operations manager with mock operation
	server.operationsManager = mcpserver.NewOperationsManager(&doc, zap.NewNop(), false)
	server.schemaCompiler = mcpserver.NewSchemaCompiler(zap.NewNop())

	// Mock operation (normally loaded from file)
	mockOperation := &mcpserver.Operation{
		Name:            "GetEmployeeByID",
		OperationString: `query GetEmployeeByID($id: ID!) { employee(id: $id) { id name } }`,
		OperationType:   "query",
	}

	// We need to manually add the operation since we can't easily mock the file loading
	// In a real scenario, this would be loaded from the operations directory
	server.operationsManager = &mockOperationsManager{
		operations: map[string]*mcpserver.Operation{
			"GetEmployeeByID": mockOperation,
		},
	}

	// Create a Connect RPC request
	requestData := json.RawMessage(`{"id": "1"}`)
	req := &connect.Request[json.RawMessage]{
		Msg: &requestData,
	}
	req.Spec().Procedure = "/service.v1.EmployeeService/GetEmployeeByID"

	ctx := context.Background()
	response, err := server.handleConnectRPCRequest(ctx, req)

	assert.NoError(t, err)
	assert.NotNil(t, response)
	assert.NotNil(t, response.Msg)

	// Verify response contains expected data
	var result map[string]interface{}
	err = json.Unmarshal(*response.Msg, &result)
	require.NoError(t, err)

	data, ok := result["data"].(map[string]interface{})
	require.True(t, ok)

	employee, ok := data["employee"].(map[string]interface{})
	require.True(t, ok)

	assert.Equal(t, float64(1), employee["id"])
	assert.Equal(t, "John Doe", employee["name"])
}

func TestConnectRPCServer_StartAndStop(t *testing.T) {
	server, err := NewConnectRPCServer(
		"http://localhost:4000/graphql",
		WithListenAddr("127.0.0.1:0"), // Use random port
		WithLogger(zap.NewNop()),
	)
	require.NoError(t, err)

	// Test start
	err = server.Start()
	assert.NoError(t, err)
	assert.NotNil(t, server.httpServer)

	// Give the server a moment to start
	time.Sleep(100 * time.Millisecond)

	// Test stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err = server.Stop(ctx)
	assert.NoError(t, err)
}

func TestWithCORS(t *testing.T) {
	server := &ConnectRPCServer{}
	
	// Create a test handler
	testHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// Wrap with CORS middleware
	corsHandler := server.withCORS("GET", "POST")(testHandler)

	// Test regular request
	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	corsHandler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Methods"), "GET")
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Methods"), "POST")
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Methods"), "OPTIONS")

	// Test OPTIONS preflight request
	req = httptest.NewRequest("OPTIONS", "/test", nil)
	w = httptest.NewRecorder()
	corsHandler.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "*", w.Header().Get("Access-Control-Allow-Origin"))
}

// Mock operations manager for testing
type mockOperationsManager struct {
	operations map[string]*mcpserver.Operation
}

func (m *mockOperationsManager) GetOperation(name string) *mcpserver.Operation {
	return m.operations[name]
}

func (m *mockOperationsManager) LoadOperationsFromDirectory(dir string) error {
	return nil
}

func (m *mockOperationsManager) GetOperations() []mcpserver.Operation {
	var ops []mcpserver.Operation
	for _, op := range m.operations {
		ops = append(ops, *op)
	}
	return ops
}

func (m *mockOperationsManager) GetFilteredOperations() []mcpserver.Operation {
	return m.GetOperations()
}

func (m *mockOperationsManager) GetSchema() *ast.Document {
	return nil
}