package integration

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	employeev1 "github.com/wundergraph/cosmo/router-tests/testdata/connectrpc/client/employee.v1"
)

// TestConnectRPCUnknownRoute checks that an unknown RPC path gets an error in
// the protocol the client speaks, not a bare text 404.
func TestConnectRPCUnknownRoute(t *testing.T) {
	t.Parallel()

	const path = "/employee.v1.EmployeeService/DoesNotExist"

	startServer := func(t *testing.T) (*TestConnectRPCServer, string) {
		t.Helper()
		ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{})
		require.NoError(t, ts.Start())
		return ts, "http://" + ts.Addr().String() + path
	}

	// Streaming calls, so the request announces a framed protocol.
	assertStreamError := func(t *testing.T, url string, opts ...connect.ClientOption) {
		t.Helper()
		client := connect.NewClient[employeev1.GetEmployeeByIdRequest, employeev1.GetEmployeeByIdResponse](http.DefaultClient, url, opts...)
		stream, err := client.CallServerStream(t.Context(), connect.NewRequest(&employeev1.GetEmployeeByIdRequest{}))
		require.NoError(t, err)
		defer stream.Close()

		assert.False(t, stream.Receive())
		assert.Equal(t, connect.CodeUnimplemented, connect.CodeOf(stream.Err()))
		assert.ErrorContains(t, stream.Err(), "method not found: "+path)
	}

	_, url := startServer(t)

	t.Run("unary Connect gets HTTP 404 with a JSON error", func(t *testing.T) {
		t.Parallel()

		resp, err := http.Post(url, "application/json", strings.NewReader(`{}`))
		require.NoError(t, err)
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		assert.Equal(t, http.StatusNotFound, resp.StatusCode)
		assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
		assert.JSONEq(t, `{"code":"unimplemented","message":"method not found: `+path+`"}`, string(body))
	})

	t.Run("gRPC-Web gets unimplemented", func(t *testing.T) {
		t.Parallel()
		assertStreamError(t, url, connect.WithGRPCWeb())
	})

	t.Run("Connect streaming gets unimplemented", func(t *testing.T) {
		t.Parallel()
		assertStreamError(t, url)
	})

	t.Run("still applies after a reload", func(t *testing.T) {
		t.Parallel()

		// Reload swaps the handler, so this needs its own server.
		ts, url := startServer(t)
		require.NoError(t, ts.Reload())
		assertStreamError(t, url)
	})
}
