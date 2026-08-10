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

	goodDir := t.TempDir()
	writeOperationFiles(t, goodDir, map[string]string{
		"FindEmployee.graphql": findEmployeeOp,
	})

	good := newTestServerWithOperationsDir(t, "/mcp/support", goodDir)
	bad := newTestServerWithOperationsDir(t, "/billing/mcp", filepath.Join(t.TempDir(), "does-not-exist"))

	h := NewHost(HostOptions{ListenAddr: "localhost:0", Logger: zap.NewNop()})
	require.NoError(t, h.Register(good))
	require.NoError(t, h.Register(bad))

	// The broken collection must not fail the reload of the whole host.
	require.NoError(t, h.Reload(testSchemaDocument(t), nil))

	// The healthy server actually registered its operation tool, not merely
	// a non-nil operationsManager pointer: that field is assigned before the
	// operations directory is even read, so a nil check alone proves nothing.
	require.Contains(t, good.registeredTools, "execute_operation_find_employee")

	// The broken collection registers no operation tools, but Reload no
	// longer aborts before registerTools runs: the built-in tools are still
	// present.
	require.Contains(t, bad.registeredTools, "get_schema")
	require.Contains(t, bad.registeredTools, "get_operation_info")
	require.NotContains(t, bad.registeredTools, "execute_operation_find_employee")

	// Calling Reload directly on the broken server, not only through the
	// host, must return nil. Before this fix it returned an error and
	// aborted before registerTools ran.
	require.NoError(t, bad.Reload(testSchemaDocument(t), nil))
}
