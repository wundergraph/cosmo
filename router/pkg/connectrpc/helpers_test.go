package connectrpc

import (
	"io"
	"net/http"
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

// MockHTTPClient creates a mock HTTP client that returns predefined responses
func MockHTTPClient(statusCode int, responseBody string) *http.Client {
	return &http.Client{
		Transport: &mockRoundTripper{
			statusCode:   statusCode,
			responseBody: responseBody,
		},
	}
}

// buildTestOperations creates a test operations map for a service.
// This is a test-only helper that builds the operations map for the immutable registry.
func buildTestOperations(serviceName, operationName string, op *schemaloader.Operation) map[string]map[string]*schemaloader.Operation {
	return map[string]map[string]*schemaloader.Operation{
		serviceName: {
			operationName: op,
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

	// Build test operations map
	serviceName := "employee.v1.EmployeeService"
	operations := buildTestOperations(serviceName, "GetEmployeeById", &schemaloader.Operation{
		Name:            "GetEmployeeById",
		OperationType:   "query",
		OperationString: "query GetEmployeeById($id: Int!) { employee(id: $id) { id name } }",
	})

	// Create immutable operation registry
	opRegistry := NewOperationRegistry(operations)

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
