package mcpserver

import (
	"context"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
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

func newTestServerWithOperationsDir(t *testing.T, mountPath, operationsDir string) *GraphQLSchemaServer {
	t.Helper()

	srv, err := NewGraphQLSchemaServer(
		context.Background(),
		"http://localhost:3002/graphql",
		WithMountPath(mountPath),
		WithOperationsDir(operationsDir),
		WithLogger(zap.NewNop()),
	)
	require.NoError(t, err)
	t.Cleanup(srv.Close)

	return srv
}

// testSchemaDocument builds the same schema fixture the Reload tests in
// server_test.go use, so this test exercises the same code path.
func testSchemaDocument(t *testing.T) *ast.Document {
	t.Helper()

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	return &schemaDoc
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

func TestHostReloadIsolatesAnUnreadableCollection(t *testing.T) {
	t.Parallel()

	good := newTestServerWithOperationsDir(t, "/mcp/support", t.TempDir())
	bad := newTestServerWithOperationsDir(t, "/billing/mcp", filepath.Join(t.TempDir(), "does-not-exist"))

	h := NewHost(HostOptions{ListenAddr: "localhost:0", Logger: zap.NewNop()})
	require.NoError(t, h.Register(good))
	require.NoError(t, h.Register(bad))

	// The broken collection must not fail the reload of the whole host.
	require.NoError(t, h.Reload(testSchemaDocument(t), nil))

	// The healthy server still built its tool registry.
	require.NotNil(t, good.operationsManager)
}
