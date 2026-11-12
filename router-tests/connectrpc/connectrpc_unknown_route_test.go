package integration

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	employeev1 "github.com/wundergraph/cosmo/router-tests/testdata/connectrpc/client/employee.v1"
)

// TestConnectRPCUnknownRoute checks that a request for a path with no registered
// RPC gets an error in the protocol the client speaks, not a bare text 404.
func TestConnectRPCUnknownRoute(t *testing.T) {
	t.Parallel()

	const (
		unknownMethodPath  = "/employee.v1.EmployeeService/DoesNotExist"
		unknownServicePath = "/does.not.Exist/Method"
	)

	startServer := func(t *testing.T) (*TestConnectRPCServer, string) {
		t.Helper()
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})
		require.NoError(t, ts.Start())
		return ts, "http://" + ts.Addr().String()
	}

	callUnknown := func(t *testing.T, httpClient *http.Client, url string, opts ...connect.ClientOption) *connect.Error {
		t.Helper()
		client := connect.NewClient[employeev1.GetEmployeeByIdRequest, employeev1.GetEmployeeByIdResponse](httpClient, url, opts...)
		_, err := client.CallUnary(context.Background(), connect.NewRequest(&employeev1.GetEmployeeByIdRequest{EmployeeId: 1}))

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		return connectErr
	}

	_, baseURL := startServer(t)

	p := &http.Protocols{}
	p.SetUnencryptedHTTP2(true)
	h2cClient := &http.Client{Transport: &http.Transport{Protocols: p}}

	protocols := []struct {
		name       string
		httpClient *http.Client
		opts       []connect.ClientOption
	}{
		{name: "Connect", httpClient: http.DefaultClient},
		{name: "gRPC", httpClient: h2cClient, opts: []connect.ClientOption{connect.WithGRPC()}},
		{name: "gRPC-Web", httpClient: http.DefaultClient, opts: []connect.ClientOption{connect.WithGRPCWeb()}},
	}
	for _, protocol := range protocols {
		t.Run(protocol.name+" client gets unimplemented for an unknown method", func(t *testing.T) {
			t.Parallel()

			connectErr := callUnknown(t, protocol.httpClient, baseURL+unknownMethodPath, protocol.opts...)
			assert.Equal(t, connect.CodeUnimplemented, connectErr.Code())
			assert.Equal(t, "method not found: "+unknownMethodPath, connectErr.Message())
		})
	}

	t.Run("Connect streaming client gets unimplemented for an unknown method", func(t *testing.T) {
		t.Parallel()

		client := connect.NewClient[employeev1.GetEmployeeByIdRequest, employeev1.GetEmployeeByIdResponse](http.DefaultClient, baseURL+unknownMethodPath)
		stream, err := client.CallServerStream(context.Background(), connect.NewRequest(&employeev1.GetEmployeeByIdRequest{EmployeeId: 1}))
		require.NoError(t, err)
		defer stream.Close()

		require.False(t, stream.Receive())

		var connectErr *connect.Error
		require.ErrorAs(t, stream.Err(), &connectErr)
		assert.Equal(t, connect.CodeUnimplemented, connectErr.Code())
		assert.Equal(t, "method not found: "+unknownMethodPath, connectErr.Message())
	})

	t.Run("unknown service gets a Connect error envelope with HTTP 404", func(t *testing.T) {
		t.Parallel()

		req, err := http.NewRequest(http.MethodPost, baseURL+unknownServicePath, strings.NewReader(`{}`))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/json")

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
		assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
		assert.JSONEq(t, `{"code":"unimplemented","message":"method not found: `+unknownServicePath+`"}`, string(body))
	})

	t.Run("still applies after a reload", func(t *testing.T) {
		t.Parallel()

		// Reload swaps the handler, so this needs a server of its own.
		ts, reloadedURL := startServer(t)
		require.NoError(t, ts.Reload())

		connectErr := callUnknown(t, http.DefaultClient, reloadedURL+unknownServicePath)
		assert.Equal(t, connect.CodeUnimplemented, connectErr.Code())
		assert.Equal(t, "method not found: "+unknownServicePath, connectErr.Message())
	})
}
