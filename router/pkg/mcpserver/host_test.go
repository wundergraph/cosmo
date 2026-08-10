package mcpserver

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func newTestServer(t *testing.T, mountPath string) *GraphQLSchemaServer {
	t.Helper()

	srv, err := NewGraphQLSchemaServer(
		context.Background(),
		"http://localhost:3002/graphql",
		WithMountPath(mountPath),
		WithLogger(zap.NewNop()),
	)
	require.NoError(t, err)
	t.Cleanup(srv.Close)

	return srv
}

func mustRequest(method, path string) *http.Request {
	req, err := http.NewRequest(method, "http://localhost"+path, nil)
	if err != nil {
		panic(err)
	}
	return req
}

func TestHostRegistersEachServerOnItsOwnPath(t *testing.T) {
	t.Parallel()

	h := NewHost(HostOptions{ListenAddr: "localhost:0", Logger: zap.NewNop()})
	require.NoError(t, h.Register(newTestServer(t, "/mcp/support")))
	require.NoError(t, h.Register(newTestServer(t, "/billing/mcp")))

	mux := h.buildMux()

	for _, path := range []string{"/mcp/support", "/billing/mcp"} {
		_, pattern := mux.Handler(mustRequest(http.MethodPost, path))
		require.Equal(t, path, pattern, "expected a handler on %s", path)
	}

	_, pattern := mux.Handler(mustRequest(http.MethodPost, "/mcp"))
	require.Empty(t, pattern, "no server was mounted on /mcp")
}

func TestHostRejectsDuplicatePaths(t *testing.T) {
	t.Parallel()

	h := NewHost(HostOptions{ListenAddr: "localhost:0", Logger: zap.NewNop()})
	require.NoError(t, h.Register(newTestServer(t, "/mcp")))

	err := h.Register(newTestServer(t, "/mcp"))
	require.ErrorContains(t, err, "already registered")
}
