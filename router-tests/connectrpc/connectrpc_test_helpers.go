package integration

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
	"go.uber.org/zap"
)

// MockGraphQLServer is a test HTTP server that mocks GraphQL responses
type MockGraphQLServer struct {
	server  *http.Server
	handler http.HandlerFunc
	URL     string
}

// NewMockGraphQLServer creates a new mock GraphQL server with the given handler
func NewMockGraphQLServer(handler http.HandlerFunc) *MockGraphQLServer {
	m := &MockGraphQLServer{
		handler: handler,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
		// Log the incoming request for debugging
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()
		r.Body = io.NopCloser(bytes.NewBuffer(body))

		if m.handler != nil {
			m.handler(w, r)
		}
	})

	// Also handle root path for simpler tests
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if m.handler != nil {
			m.handler(w, r)
		}
	})

	m.server = &http.Server{
		Handler: mux,
		Addr:    "127.0.0.1:0",
	}

	listener, err := net.Listen("tcp", m.server.Addr)
	if err != nil {
		panic(err)
	}

	m.URL = "http://" + listener.Addr().String()
	go m.server.Serve(listener) //nolint:errcheck // test server

	return m
}

// Close shuts down the mock server
func (m *MockGraphQLServer) Close() {
	if m.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = m.server.Shutdown(ctx)
	}
}

// ConnectRPCServerOptions configures a test ConnectRPC server
type ConnectRPCServerOptions struct {
	ServicesDir     string
	GraphQLEndpoint string
	GraphQLHandler  http.HandlerFunc // Custom GraphQL handler (creates mock server if provided)
	ListenAddr      string
	Logger          *zap.Logger
}

// TestConnectRPCServer wraps a ConnectRPC server for testing
type TestConnectRPCServer struct {
	Server        *connectrpc.Server
	GraphQLServer *MockGraphQLServer
	t             *testing.T
	cleanupDone   bool
}

// NewTestConnectRPCServer creates a new test ConnectRPC server with automatic cleanup
func NewTestConnectRPCServer(t *testing.T, opts ConnectRPCServerOptions) *TestConnectRPCServer {
	t.Helper()

	// Set defaults
	if opts.ServicesDir == "" {
		opts.ServicesDir = "../../router/pkg/connectrpc/testdata/services"
	}
	if opts.ListenAddr == "" {
		opts.ListenAddr = "localhost:0"
	}
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}

	// Create mock GraphQL server if endpoint not provided
	var graphqlServer *MockGraphQLServer
	if opts.GraphQLEndpoint == "" {
		// Use custom handler if provided, otherwise use default
		handler := opts.GraphQLHandler
		if handler == nil {
			handler = func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"data":{}}`))
			}
		}
		graphqlServer = NewMockGraphQLServer(handler)
		opts.GraphQLEndpoint = graphqlServer.URL + "/graphql"
	}

	server, err := connectrpc.NewServer(connectrpc.ServerConfig{
		ServicesDir:     opts.ServicesDir,
		GraphQLEndpoint: opts.GraphQLEndpoint,
		ListenAddr:      opts.ListenAddr,
		Logger:          opts.Logger,
	})
	require.NoError(t, err)

	ts := &TestConnectRPCServer{
		Server:        server,
		GraphQLServer: graphqlServer,
		t:             t,
	}

	// Register cleanup
	t.Cleanup(func() {
		ts.Close()
	})

	return ts
}

// Start starts the ConnectRPC server
func (ts *TestConnectRPCServer) Start() error {
	return ts.Server.Start()
}

// Reload reloads the ConnectRPC server
func (ts *TestConnectRPCServer) Reload() error {
	return ts.Server.Reload()
}

// Close stops the server and cleans up resources
func (ts *TestConnectRPCServer) Close() {
	if ts.cleanupDone {
		return
	}
	ts.cleanupDone = true

	if ts.Server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = ts.Server.Stop(ctx)
	}

	if ts.GraphQLServer != nil {
		ts.GraphQLServer.Close()
	}
}

// Addr returns the server's listen address
func (ts *TestConnectRPCServer) Addr() net.Addr {
	return ts.Server.Addr()
}

// GetServiceCount returns the number of discovered services
func (ts *TestConnectRPCServer) GetServiceCount() int {
	return ts.Server.GetServiceCount()
}

// GetServiceNames returns the names of discovered services
func (ts *TestConnectRPCServer) GetServiceNames() []string {
	return ts.Server.GetServiceNames()
}

// GetOperationCount returns the number of loaded operations
func (ts *TestConnectRPCServer) GetOperationCount() int {
	return ts.Server.GetOperationCount()
}

// DefaultGraphQLResponse returns a standard test GraphQL response
func DefaultGraphQLResponse() string {
	return `{
		"data": {
			"employee": {
				"id": 1,
				"tag": "employee-1",
				"details": {
					"forename": "John",
					"surname": "Doe",
					"pets": [{"name": "Fluffy"}],
					"location": {"key": {"name": "San Francisco"}}
				}
			}
		}
	}`
}

// SimpleGraphQLHandler returns a handler that responds with a simple success response
func SimpleGraphQLHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":{}}`))
	}
}

// EmployeeGraphQLHandler returns a handler that responds with employee data
func EmployeeGraphQLHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(DefaultGraphQLResponse()))
	}
}

// ErrorGraphQLHandler returns a handler that responds with a GraphQL error
func ErrorGraphQLHandler(message string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintf(w, `{"errors": [{"message": "%s"}]}`, message)
	}
}

// HTTPErrorHandler returns a handler that responds with an HTTP error
func HTTPErrorHandler(statusCode int, message string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(message))
	}
}
