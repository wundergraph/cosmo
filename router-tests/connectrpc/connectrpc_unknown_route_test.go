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

	ts := NewTestConnectRPCServer(t, ConnectRPCServerOptions{
		GraphQLHandler: EmployeeGraphQLHandler(),
	})
	require.NoError(t, ts.Start())

	baseURL := "http://" + ts.Addr().String()

	p := &http.Protocols{}
	p.SetUnencryptedHTTP2(true)
	h2cClient := &http.Client{Transport: &http.Transport{Protocols: p}}

	paths := map[string]string{
		"unknown method on a known service": "/employee.v1.EmployeeService/DoesNotExist",
		"unknown service":                   "/does.not.Exist/Method",
	}

	protocols := []struct {
		name       string
		httpClient *http.Client
		opts       []connect.ClientOption
	}{
		{name: "Connect", httpClient: http.DefaultClient},
		{name: "gRPC", httpClient: h2cClient, opts: []connect.ClientOption{connect.WithGRPC()}},
		{name: "gRPC-Web", httpClient: http.DefaultClient, opts: []connect.ClientOption{connect.WithGRPCWeb()}},
	}

	call := func(t *testing.T, httpClient *http.Client, path string, opts ...connect.ClientOption) *connect.Error {
		t.Helper()
		client := connect.NewClient[employeev1.GetEmployeeByIdRequest, employeev1.GetEmployeeByIdResponse](
			httpClient, baseURL+path, opts...,
		)
		_, err := client.CallUnary(context.Background(), connect.NewRequest(&employeev1.GetEmployeeByIdRequest{EmployeeId: 1}))
		require.Error(t, err)

		var connectErr *connect.Error
		require.ErrorAs(t, err, &connectErr)
		return connectErr
	}

	for pathName, path := range paths {
		for _, protocol := range protocols {
			t.Run(protocol.name+" client, "+pathName, func(t *testing.T) {
				connectErr := call(t, protocol.httpClient, path, protocol.opts...)
				assert.Equal(t, connect.CodeUnimplemented, connectErr.Code())
				assert.Equal(t, "method not found: "+path, connectErr.Message())
			})
		}

		t.Run("Connect error envelope on the wire, "+pathName, func(t *testing.T) {
			req, err := http.NewRequest(http.MethodPost, baseURL+path, strings.NewReader(`{}`))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")

			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer resp.Body.Close()

			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)

			assert.Equal(t, http.StatusNotFound, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
			assert.JSONEq(t, `{"code":"unimplemented","message":"method not found: `+path+`"}`, string(body))
		})
	}

	t.Run("still applies after a reload", func(t *testing.T) {
		require.NoError(t, ts.Reload())

		path := "/does.not.Exist/Method"
		connectErr := call(t, http.DefaultClient, path)
		assert.Equal(t, connect.CodeUnimplemented, connectErr.Code())
		assert.Equal(t, "method not found: "+path, connectErr.Message())
	})
}
