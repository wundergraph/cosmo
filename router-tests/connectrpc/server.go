package connectrpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
	"go.uber.org/zap"
)

// TestServer encapsulates a ConnectRPC server for testing
type TestServer struct {
	server        *connectrpc.Server
	graphqlServer *httptest.Server
	servicesDir   string
	t             *testing.T
}

// Option is a functional option for configuring TestServer
type Option func(*config)

type config struct {
	servicesDir    string
	graphqlHandler http.HandlerFunc
	logger         *zap.Logger
}

// WithServicesDir sets the directory containing proto files and GraphQL operations
func WithServicesDir(dir string) Option {
	return func(c *config) {
		c.servicesDir = dir
	}
}

// WithGraphQLHandler sets a custom GraphQL handler for the mock server
func WithGraphQLHandler(handler http.HandlerFunc) Option {
	return func(c *config) {
		c.graphqlHandler = handler
	}
}

// WithLogger sets a custom logger
func WithLogger(logger *zap.Logger) Option {
	return func(c *config) {
		c.logger = logger
	}
}

func defaultConfig() config {
	return config{
		servicesDir: "testdata/connectrpc/services",
		graphqlHandler: func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"data":{"employees":[{"id":1}]}}`))
		},
		logger: zap.NewNop(),
	}
}

// NewTestServer creates a new test server with the given options
func NewTestServer(t *testing.T, opts ...Option) *TestServer {
	t.Helper()

	// Apply options
	cfg := defaultConfig()
	for _, opt := range opts {
		opt(&cfg)
	}

	// Setup mock GraphQL server
	graphqlServer := httptest.NewServer(cfg.graphqlHandler)

	// Create ConnectRPC server
	server, err := connectrpc.NewServer(connectrpc.ServerConfig{
		ServicesDir:     cfg.servicesDir,
		GraphQLEndpoint: graphqlServer.URL,
		ListenAddr:      "localhost:0",
		Logger:          cfg.logger,
	})
	require.NoError(t, err)

	ts := &TestServer{
		server:        server,
		graphqlServer: graphqlServer,
		servicesDir:   cfg.servicesDir,
		t:             t,
	}

	// Register cleanup
	t.Cleanup(func() {
		ts.Close()
	})

	return ts
}

// Close shuts down the test server and cleans up resources
func (ts *TestServer) Close() {
	if ts.graphqlServer != nil {
		ts.graphqlServer.Close()
	}
	if ts.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = ts.server.Stop(ctx)
	}
}

// Start starts the ConnectRPC server
func (ts *TestServer) Start() error {
	return ts.server.Start()
}

// Reload reloads the server configuration and operations
func (ts *TestServer) Reload() error {
	return ts.server.Reload()
}

// ServiceCount returns the number of registered services
func (ts *TestServer) ServiceCount() int {
	return ts.server.GetServiceCount()
}

// ServiceNames returns the names of all registered services
func (ts *TestServer) ServiceNames() []string {
	return ts.server.GetServiceNames()
}

// OperationCount returns the number of registered operations
func (ts *TestServer) OperationCount() int {
	return ts.server.GetOperationCount()
}

// WaitForReady waits for the server to be ready with a timeout
func (ts *TestServer) WaitForReady(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check if server is ready by verifying service count
		if ts.ServiceCount() > 0 {
			return nil
		}
		time.Sleep(time.Millisecond * 100)
	}
}

// AssertServiceDiscovered asserts that a service with the given name was discovered
func (ts *TestServer) AssertServiceDiscovered(t *testing.T, serviceName string) {
	t.Helper()
	names := ts.ServiceNames()
	require.Contains(t, names, serviceName,
		"Expected service %s to be discovered, available services: %v", serviceName, names)
}

// AssertServiceCount asserts that the number of services matches the expected count
func (ts *TestServer) AssertServiceCount(t *testing.T, expected int) {
	t.Helper()
	actual := ts.ServiceCount()
	require.Equal(t, expected, actual,
		"Expected %d services, got %d", expected, actual)
}

// AssertMinServiceCount asserts that the number of services is at least the expected minimum
func (ts *TestServer) AssertMinServiceCount(t *testing.T, min int) {
	t.Helper()
	actual := ts.ServiceCount()
	require.GreaterOrEqual(t, actual, min,
		"Expected at least %d services, got %d", min, actual)
}

// AssertOperationCount asserts that the number of operations matches the expected count
func (ts *TestServer) AssertOperationCount(t *testing.T, expected int) {
	t.Helper()
	actual := ts.OperationCount()
	require.Equal(t, expected, actual,
		"Expected %d operations, got %d", expected, actual)
}

// AssertMinOperationCount asserts that the number of operations is at least the expected minimum
func (ts *TestServer) AssertMinOperationCount(t *testing.T, min int) {
	t.Helper()
	actual := ts.OperationCount()
	require.GreaterOrEqual(t, actual, min,
		"Expected at least %d operations, got %d", min, actual)
}