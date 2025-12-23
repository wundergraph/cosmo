package integration

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	employeev1 "github.com/wundergraph/cosmo/router-tests/testdata/connectrpc/client/employee.v1"
	"github.com/wundergraph/cosmo/router-tests/testdata/connectrpc/client/employee.v1/employeev1connect"
	"golang.org/x/net/http2"
)

// TestConnectRPC_ClientProtocols tests all three RPC protocols (Connect, gRPC, gRPC-Web)
// using generated client code to ensure proper multi-protocol support
func TestConnectRPC_ClientProtocols(t *testing.T) {
	t.Parallel()

	// Use shared helper for employee GraphQL handler
	ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
		GraphQLHandler: EmployeeGraphQLHandler(),
	})
	defer ts.Close()
	
	err := ts.Start()
	require.NoError(t, err)

	baseURL := "http://" + ts.Addr().String()

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
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
			GraphQLHandler: ErrorGraphQLHandler("Employee not found"),
		})
		
		err := ts.Start()
		require.NoError(t, err)

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+ts.Addr().String(),
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

	t.Run("GraphQL error with partial data returns error", func(t *testing.T) {
		// Custom handler for partial data with errors
		// Per GraphQL spec, errors at top level indicate a failure even with partial data
		handler := func(w http.ResponseWriter, r *http.Request) {
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
				},
				"errors": [{"message": "Could not fetch pets"}]
			}`))
		}
		
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
			GraphQLHandler: handler,
		})
		
		err := ts.Start()
		require.NoError(t, err)

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+ts.Addr().String(),
		)

		req := connect.NewRequest(&employeev1.GetEmployeeByIdRequest{
			EmployeeId: 1,
		})

		_, err = client.GetEmployeeById(context.Background(), req)
		// Per GraphQL spec, errors at top level should result in an error
		require.Error(t, err)
		
		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		assert.Equal(t, connect.CodeUnknown, connectErr.Code())
		assert.Contains(t, connectErr.Message(), "GraphQL partial success with errors")
	})

	t.Run("HTTP 404 maps to CodeNotFound", func(t *testing.T) {
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
			GraphQLHandler: HTTPErrorHandler(http.StatusNotFound, "Not Found"),
		})
		
		err := ts.Start()
		require.NoError(t, err)

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+ts.Addr().String(),
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
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
			GraphQLHandler: HTTPErrorHandler(http.StatusInternalServerError, "Internal Server Error"),
		})
		
		err := ts.Start()
		require.NoError(t, err)

		client := employeev1connect.NewEmployeeServiceClient(
			http.DefaultClient,
			"http://"+ts.Addr().String(),
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

	var requestCount int64
	handler := func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&requestCount, 1)
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
	}
	
	ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
		GraphQLHandler: handler,
	})
	
	err := ts.Start()
	require.NoError(t, err)

	client := employeev1connect.NewEmployeeServiceClient(
		http.DefaultClient,
		"http://"+ts.Addr().String(),
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

	assert.Equal(t, int64(numRequests), atomic.LoadInt64(&requestCount), "should have made all requests")
}