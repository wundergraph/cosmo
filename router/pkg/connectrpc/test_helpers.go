package connectrpc

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
)

// Shared proto loader to avoid registration conflicts across tests
var (
	sharedProtoLoaders     = make(map[string]*ProtoLoader)
	sharedProtoLoaderMutex sync.Mutex
)

// GetSharedProtoLoader returns a shared proto loader instance for the given directory.
// This ensures proto files are loaded exactly once per directory to avoid registration conflicts.
func GetSharedProtoLoader(t *testing.T, dir string) *ProtoLoader {
	t.Helper()

	sharedProtoLoaderMutex.Lock()
	defer sharedProtoLoaderMutex.Unlock()

	if loader, exists := sharedProtoLoaders[dir]; exists {
		return loader
	}

	loader := NewProtoLoader(zap.NewNop())
	err := loader.LoadFromDirectory(dir)
	require.NoError(t, err, "failed to load proto files from %s", dir)

	sharedProtoLoaders[dir] = loader
	return loader
}

// MockGraphQLServer represents a mock GraphQL server for testing
type MockGraphQLServer struct {
	*httptest.Server
	ResponseBody string
}

// NewMockGraphQLServer creates a new mock GraphQL server that returns the given response
func NewMockGraphQLServer(responseBody string) *MockGraphQLServer {
	server := &MockGraphQLServer{
		ResponseBody: responseBody,
	}

	server.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(server.ResponseBody))
	}))

	return server
}

// MockHTTPClient creates a mock HTTP client that returns predefined responses
func MockHTTPClient(statusCode int, responseBody string) *http.Client {
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

// NewTestRPCHandler creates a test RPC handler with sensible defaults
func NewTestRPCHandler(t *testing.T, protoLoader *ProtoLoader) *RPCHandler {
	t.Helper()

	// Create operation registry
	opRegistry := NewOperationRegistry(zap.NewNop())

	// Manually add test operations to the registry using service-scoped approach
	serviceName := "employee.v1.EmployeeService"
	if opRegistry.operations[serviceName] == nil {
		opRegistry.operations[serviceName] = make(map[string]*schemaloader.Operation)
	}
	opRegistry.operations[serviceName]["GetEmployeeById"] = &schemaloader.Operation{
		Name:            "GetEmployeeById",
		OperationType:   "query",
		OperationString: "query GetEmployeeById($id: Int!) { employee(id: $id) { id name } }",
	}

	handler, err := NewRPCHandler(HandlerConfig{
		GraphQLEndpoint:   "http://localhost:4000/graphql",
		HTTPClient:        &http.Client{},
		Logger:            zap.NewNop(),
		OperationRegistry: opRegistry,
		ProtoLoader:       protoLoader,
	})
	require.NoError(t, err)

	return handler
}
