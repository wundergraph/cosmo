package mcpserver

import (
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

// newTestSession builds a GraphQLSchemaServer with the given options and
// connects an in-memory MCP client to it. The SDK client negotiates via the
// SEP-2575 server/discover RPC by default (protocol version 2026-07-28), so
// the returned session state reflects the server/discover response.
func newTestSession(t *testing.T, opts ...func(*Options)) *mcp.ClientSession {
	t.Helper()

	tempDir := t.TempDir()
	writeOperationFiles(t, tempDir, map[string]string{
		"ListEmployees.graphql": listEmployeesOp,
	})

	schemaDoc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&schemaDoc))

	srv, err := NewGraphQLSchemaServer(
		t.Context(),
		"http://localhost:4000/graphql",
		append([]func(*Options){
			WithLogger(zap.NewNop()),
			WithOperationsDir(tempDir),
		}, opts...)...,
	)
	require.NoError(t, err)
	require.NoError(t, srv.Reload(&schemaDoc, nil, "schema-version-test"))

	serverTransport, clientTransport := mcp.NewInMemoryTransports()

	ss, err := srv.server.Connect(t.Context(), serverTransport, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = ss.Close() })

	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	cs, err := client.Connect(t.Context(), clientTransport, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = cs.Close() })

	return cs
}

func TestDiscover(t *testing.T) {
	t.Run("returns configured instructions", func(t *testing.T) {
		const instructions = "Call list_employees before querying individual employees."

		cs := newTestSession(t, WithInstructions(instructions))

		assert.Equal(t, instructions, cs.InitializeResult().Instructions)
	})

	t.Run("no instructions by default", func(t *testing.T) {
		cs := newTestSession(t)

		assert.Empty(t, cs.InitializeResult().Instructions)
	})

	t.Run("serverInfo uses configured version", func(t *testing.T) {
		cs := newTestSession(t, WithServerVersion("1.2.3"))

		serverInfo := cs.InitializeResult().ServerInfo
		require.NotNil(t, serverInfo)
		assert.Equal(t, "1.2.3", serverInfo.Version)
	})

	t.Run("serverInfo carries title and description", func(t *testing.T) {
		cs := newTestSession(t,
			WithServerTitle("My Commerce API"),
			WithServerDescription("Query products, orders and customers."),
		)

		serverInfo := cs.InitializeResult().ServerInfo
		require.NotNil(t, serverInfo)
		assert.Equal(t, "My Commerce API", serverInfo.Title)
		assert.Equal(t, "Query products, orders and customers.", serverInfo.Description)
	})

	t.Run("empty graph name falls back to default", func(t *testing.T) {
		// WithGraphName("") must not clobber the default: an empty graph name
		// would produce the malformed serverInfo name "wundergraph-cosmo-".
		cs := newTestSession(t, WithGraphName(""))

		serverInfo := cs.InitializeResult().ServerInfo
		require.NotNil(t, serverInfo)
		assert.Equal(t, "wundergraph-cosmo-graph", serverInfo.Name)
	})
}
