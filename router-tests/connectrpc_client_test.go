package integration

import (
	"bytes"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	employeev1 "github.com/wundergraph/cosmo/router-tests/testdata/connectrpc/client/employee.v1"
	"github.com/wundergraph/cosmo/router-tests/testdata/connectrpc/client/employee.v1/employeev1connect"
	"github.com/wundergraph/cosmo/router/pkg/connectrpc"
	"go.uber.org/zap"
	"golang.org/x/net/http2"
)

// TestConnectRPC_ClientProtocols tests all three RPC protocols (Connect, gRPC, gRPC-Web)
// using generated client code to ensure proper multi-protocol support
func TestConnectRPC_ClientProtocols(t *testing.T) {
	t.Parallel()

	// Create mock GraphQL server
	graphqlServer := newMockGraphQLServer(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
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
		}`))
	})
	defer graphqlServer.Close()

	// Start ConnectRPC server
	graphqlEndpoint := graphqlServer.URL + "/graphql"
	fmt.Printf("[Test] Mock GraphQL Server URL: %s\n", graphqlServer.URL)
	fmt.Printf("[Test] GraphQL Endpoint configured: %s\n", graphqlEndpoint)
	
	server, err := connectrpc.NewServer(connectrpc.ServerConfig{
		ServicesDir:     "testdata/connectrpc/services",
		GraphQLEndpoint: graphqlEndpoint,
		ListenAddr:      "localhost:0",
		Logger:          zap.NewNop(),
	})
	require.NoError(t, err)

	err = server.Start()
	require.NoError(t, err)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	}()

	baseURL := "http://" + server.Addr().String()

	t.Run("Connect protocol", func(t *testing.T) {
		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			baseURL,
			// Connect protocol is the default
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		resp, err := client.GetEmployeeById(context.Background(), req)
		require.NoError(t, err)
		require.NotNil(t, resp.Msg.Employee)

		assert.Equal(t, int32(1), resp.Msg.Employee.Id)
		assert.Equal(t, "employee-1", resp.Msg.Employee.Tag)
		assert.Equal(t, "John", resp.Msg.Employee.Details.Forename)
		assert.Equal(t, "Doe", resp.Msg.Employee.Details.Surname)
		assert.Len(t, resp.Msg.Employee.Details.Pets, 1)
		assert.Equal(t, "Fluffy", resp.Msg.Employee.Details.Pets[0].Name)
		assert.Equal(t, "San Francisco", resp.Msg.Employee.Details.Location.Key.Name)
	})

	t.Run("gRPC protocol", func(t *testing.T) {
		// Create HTTP client with h2c support for gRPC over HTTP/1.1
		// This mimics what grpcurl does with -plaintext flag
		h2cClient := &http.Client{
			Transport: &http2.Transport{
				// Allow HTTP/2 without TLS (h2c)
				AllowHTTP: true,
				// Use a custom dialer that doesn't require TLS
				DialTLS: func(network, addr string, cfg *tls.Config) (net.Conn, error) {
					return net.Dial(network, addr)
				},
			},
		}

		client := employeev1connect.NewEmployeeServiceClient(
			h2cClient,
			baseURL,
			connect.WithGRPC(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		resp, err := client.GetEmployeeById(context.Background(), req)
		require.NoError(t, err)
		require.NotNil(t, resp.Msg.Employee)

		assert.Equal(t, int32(1), resp.Msg.Employee.Id)
		assert.Equal(t, "John", resp.Msg.Employee.Details.Forename)
	})

	t.Run("gRPC-Web protocol", func(t *testing.T) {
		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			baseURL,
			connect.WithGRPCWeb(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		resp, err := client.GetEmployeeById(context.Background(), req)
		require.NoError(t, err)
		require.NotNil(t, resp.Msg.Employee)

		assert.Equal(t, int32(1), resp.Msg.Employee.Id)
		assert.Equal(t, "John", resp.Msg.Employee.Details.Forename)
	})
}

// TestConnectRPC_ClientErrorHandling tests error scenarios with generated client
func TestConnectRPC_ClientErrorHandling(t *testing.T) {
	t.Parallel()

	t.Run("GraphQL error with no data returns CRITICAL", func(t *testing.T) {
		graphqlServer := newMockGraphQLServer(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"errors": [{"message": "Employee not found"}]
			}`))
		})
		defer graphqlServer.Close()

		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "testdata/connectrpc/services",
			GraphQLEndpoint: graphqlServer.URL + "/graphql",
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			server.Stop(ctx)
		}()

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+server.Addr().String(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 999,
		})

		_, err = client.GetEmployeeById(context.Background(), req)
		require.Error(t, err)

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		// GraphQL errors use CodeUnknown (not CodeInternal which implies server bugs)
		assert.Equal(t, connect.CodeUnknown, connectErr.Code())
		assert.Contains(t, connectErr.Message(), "Employee not found")
	})

	t.Run("GraphQL error with partial data returns NON-CRITICAL", func(t *testing.T) {
		graphqlServer := newMockGraphQLServer(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"data": {
					"employee": {
						"id": 1,
						"tag": "employee-1",
						"details": {
							"forename": "John",
							"surname": "Doe"
						}
					},
					"errors": [{"message": "Could not fetch pets"}]
				}
			}`))
		})
		defer graphqlServer.Close()

		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "testdata/connectrpc/services",
			GraphQLEndpoint: graphqlServer.URL + "/graphql",
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			server.Stop(ctx)
		}()

		time.Sleep(100 * time.Millisecond)
		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+server.Addr().String(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		resp, err := client.GetEmployeeById(context.Background(), req)
		// Should succeed with partial data
		require.NoError(t, err)
		require.NotNil(t, resp.Msg.Employee)
		assert.Equal(t, int32(1), resp.Msg.Employee.Id)
		assert.Equal(t, "John", resp.Msg.Employee.Details.Forename)
	})

	t.Run("HTTP 404 maps to CodeNotFound", func(t *testing.T) {
		graphqlServer := newMockGraphQLServer(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			w.Write([]byte("Not Found"))
		})
		defer graphqlServer.Close()

		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "testdata/connectrpc/services",
			GraphQLEndpoint: graphqlServer.URL + "/graphql",
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			server.Stop(ctx)
		}()

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+server.Addr().String(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		_, err = client.GetEmployeeById(context.Background(), req)
		require.Error(t, err)

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		assert.Equal(t, connect.CodeNotFound, connectErr.Code())
	})

	t.Run("HTTP 500 maps to CodeInternal", func(t *testing.T) {
		graphqlServer := newMockGraphQLServer(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("Internal Server Error"))
		})
		defer graphqlServer.Close()

		server, err := connectrpc.NewServer(connectrpc.ServerConfig{
			ServicesDir:     "testdata/connectrpc/services",
			GraphQLEndpoint: graphqlServer.URL + "/graphql",
			ListenAddr:      "localhost:0",
			Logger:          zap.NewNop(),
		})
		require.NoError(t, err)

		err = server.Start()
		require.NoError(t, err)
		defer func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			server.Stop(ctx)
		}()

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+server.Addr().String(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		_, err = client.GetEmployeeById(context.Background(), req)
		require.Error(t, err)

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		assert.Equal(t, connect.CodeInternal, connectErr.Code())
	})
}

// TestConnectRPC_ClientConcurrency tests concurrent requests with generated client
func TestConnectRPC_ClientConcurrency(t *testing.T) {
	t.Parallel()

	var requestCount int
	graphqlServer := newMockGraphQLServer(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{
			"data": {
				"employee": {
					"id": 1,
					"tag": "employee-1",
					"details": {
						"forename": "John",
						"surname": "Doe"
					}
				}
			}
		}`))
	})
	defer graphqlServer.Close()

	server, err := connectrpc.NewServer(connectrpc.ServerConfig{
		ServicesDir:     "testdata/connectrpc/services",
		GraphQLEndpoint: graphqlServer.URL + "/graphql",
		ListenAddr:      "localhost:0",
		Logger:          zap.NewNop(),
	})
	require.NoError(t, err)

	err = server.Start()
	require.NoError(t, err)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Stop(ctx)
	}()

	client := employeev1connect.NewEmployeeServiceClient(
		http.DefaultClient,
		"http://"+server.Addr().String(),
	)

	// Make 10 concurrent requests
	const numRequests = 10
	results := make(chan error, numRequests)

	for i := 0; i < numRequests; i++ {
		go func() {
			req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
				EmployeeId: 1,
			})
			_, err := client.GetEmployeeById(context.Background(), req)
			results <- err
		}()
	}

	// Collect results
	for i := 0; i < numRequests; i++ {
		err := <-results
		assert.NoError(t, err)
	}

	assert.Equal(t, numRequests, requestCount, "should have made all requests")
}

// mockGraphQLServer is a simple mock HTTP server for testing
type mockGraphQLServer struct {
	server  *http.Server
	handler http.HandlerFunc
	URL     string
}

func newMockGraphQLServer(handler http.HandlerFunc) *mockGraphQLServer {
	m := &mockGraphQLServer{
		handler: handler,
	}
	
	mux := http.NewServeMux()
	mux.HandleFunc("/graphql", func(w http.ResponseWriter, r *http.Request) {
		// Log the incoming request for debugging
		body, _ := io.ReadAll(r.Body)
		r.Body.Close()
		r.Body = io.NopCloser(bytes.NewBuffer(body))
		
		fmt.Printf("[MockGraphQL] Request: %s %s\n", r.Method, r.URL.Path)
		fmt.Printf("[MockGraphQL] Headers: %v\n", r.Header)
		fmt.Printf("[MockGraphQL] Body: %s\n", string(body))
		
		if m.handler != nil {
			m.handler(w, r)
		}
		
		fmt.Printf("[MockGraphQL] Response sent\n\n")
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
	
	go m.server.Serve(listener)
	
	// Give the server a moment to start
	time.Sleep(10 * time.Millisecond)
	
	return m
}

func (m *mockGraphQLServer) Close() {
	if m.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		m.server.Shutdown(ctx)
	}
}