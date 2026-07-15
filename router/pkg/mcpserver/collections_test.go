package mcpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/cors"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

// newCollectionTestServer creates a schema server with the FindEmployee and
// ListEmployees operations loaded from a temp directory. Reload is left to the
// caller so tests can control registration order.
func newCollectionTestServer(t *testing.T) *GraphQLSchemaServer {
	t.Helper()

	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"FindEmployee.graphql":  findEmployeeOp,
		"ListEmployees.graphql": listEmployeesOp,
	})

	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		WithLogger(zap.NewNop()),
		WithOperationsDir(tempDir),
		WithOmitToolNamePrefix(true),
		WithCORS(cors.Config{}),
	)
	require.NoError(t, err)

	return srv
}

func reloadTestServer(t *testing.T, srv *GraphQLSchemaServer) {
	t.Helper()

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
	require.NoError(t, err)

	err = srv.Reload(&schemaDoc, nil)
	require.NoError(t, err)
}

// listToolNames connects an MCP client to the given endpoint and returns the
// names of the tools it advertises.
func listToolNames(t *testing.T, endpoint string) []string {
	t.Helper()

	ctx := t.Context()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{
		Endpoint:             endpoint,
		DisableStandaloneSSE: true,
	}, nil)
	require.NoError(t, err)
	defer session.Close()

	res, err := session.ListTools(ctx, nil)
	require.NoError(t, err)

	names := make([]string, 0, len(res.Tools))
	for _, tool := range res.Tools {
		names = append(names, tool.Name)
	}
	return names
}

func TestCollections_DisjointToolLists(t *testing.T) {
	srv := newCollectionTestServer(t)

	require.NoError(t, srv.RegisterCollection("a", []string{"FindEmployee"}))
	require.NoError(t, srv.RegisterCollection("b", []string{"ListEmployees"}))

	reloadTestServer(t, srv)

	ts := httptest.NewServer(srv.buildHandler())
	defer ts.Close()

	assert.ElementsMatch(t, []string{"find_employee"}, listToolNames(t, ts.URL+"/mcp/a"))
	assert.ElementsMatch(t, []string{"list_employees"}, listToolNames(t, ts.URL+"/mcp/b"))

	// The default endpoint is unchanged: all operation tools plus built-ins.
	assert.ElementsMatch(t, []string{
		"get_schema",
		"find_employee",
		"list_employees",
		"get_operation_info",
	}, listToolNames(t, ts.URL+"/mcp"))
}

func TestCollections_RegisterAfterReload(t *testing.T) {
	srv := newCollectionTestServer(t)

	reloadTestServer(t, srv)

	require.NoError(t, srv.RegisterCollection("a", []string{"FindEmployee"}))

	ts := httptest.NewServer(srv.buildHandler())
	defer ts.Close()

	assert.ElementsMatch(t, []string{"find_employee"}, listToolNames(t, ts.URL+"/mcp/a"))
}

func TestCollections_UnknownSlugNotFound(t *testing.T) {
	srv := newCollectionTestServer(t)

	require.NoError(t, srv.RegisterCollection("a", []string{"FindEmployee"}))

	reloadTestServer(t, srv)

	ts := httptest.NewServer(srv.buildHandler())
	defer ts.Close()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, ts.URL+"/mcp/unknown", strings.NewReader(`{}`))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestCollections_RegistrationErrors(t *testing.T) {
	srv := newCollectionTestServer(t)

	for _, slug := range []string{"", "Has Spaces", "a/b", "UPPER", "-leading-dash"} {
		err := srv.RegisterCollection(slug, []string{"FindEmployee"})
		assert.Error(t, err, "slug %q should be rejected", slug)
	}

	require.NoError(t, srv.RegisterCollection("valid-slug_1", []string{"FindEmployee"}))
	err := srv.RegisterCollection("valid-slug_1", []string{"ListEmployees"})
	assert.ErrorContains(t, err, "already registered")
}
