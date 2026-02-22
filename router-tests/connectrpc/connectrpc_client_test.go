package integration

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net"
	"net/http"
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

	expectedEmployee := `{
		"id": 1,
		"tag": "employee-1",
		"details": {
			"forename": "John",
			"surname": "Doe",
			"pets": [{"name": "Fluffy"}],
			"location": {"key": {"name": "San Francisco"}}
		}
	}`

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

		employeeJSON, err := json.Marshal(resp.Msg.Employee)
		require.NoError(t, err)
		require.JSONEq(t, expectedEmployee, string(employeeJSON))
	})

	t.Run("gRPC protocol", func(t *testing.T) {
		// Create HTTP client with h2c (HTTP/2 cleartext) support for gRPC without TLS
		// This mimics what grpcurl does with -plaintext flag
		h2cClient := &http.Client{
			Transport: &http2.Transport{
				// Allow HTTP/2 without TLS (h2c)
				AllowHTTP: true,
				// Use a custom dialer that doesn't require TLS
				DialTLSContext: func(ctx context.Context, network, addr string, cfg *tls.Config) (net.Conn, error) {
					var d net.Dialer
					return d.DialContext(ctx, network, addr)
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

		employeeJSON, err := json.Marshal(resp.Msg.Employee)
		require.NoError(t, err)
		require.JSONEq(t, expectedEmployee, string(employeeJSON))
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

		employeeJSON, err := json.Marshal(resp.Msg.Employee)
		require.NoError(t, err)
		require.JSONEq(t, expectedEmployee, string(employeeJSON))
	})
}

// TestConnectRPC_ClientErrorHandling tests error scenarios with generated client
func TestConnectRPC_ClientErrorHandling(t *testing.T) {
	t.Parallel()

	t.Run("GraphQL error with no data returns error", func(t *testing.T) {
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
			_, _ = w.Write([]byte(`{
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

	t.Run("HTTP 404 maps to CodeUnimplemented", func(t *testing.T) {
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
		assert.Equal(t, connect.CodeUnimplemented, connectErr.Code())
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

	t.Run("multiple GraphQL errors with extension codes", func(t *testing.T) {
		// Simulate a GraphQL response with multiple errors containing extension codes
		handler := func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{
				"data": null,
				"errors": [
					{
						"message": "You are not authorized to access this resource",
						"path": ["employee"],
						"extensions": {
							"code": "UNAUTHORIZED",
							"statusCode": 401
						}
					},
					{
						"message": "Rate limit exceeded",
						"path": ["employee"],
						"extensions": {
							"code": "RATE_LIMITED",
							"retryAfter": 60
						}
					}
				]
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
		require.Error(t, err)

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		assert.Equal(t, connect.CodeUnknown, connectErr.Code())

		// The error message contains the first GraphQL error and indicates additional errors
		// Format: "GraphQL operation failed: <first error message> (and N more errors)"
		assert.Contains(t, connectErr.Message(), "You are not authorized to access this resource")
		assert.Contains(t, connectErr.Message(), "and 1 more errors")
	})
}
