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

// connectTestClient connects an in-memory MCP client to the given server and
// returns the client session. The SDK client negotiates via the SEP-2575
// server/discover RPC by default (protocol version 2026-07-28), so the
// returned session state reflects the server/discover response.
func connectTestClient(t *testing.T, srv *GraphQLSchemaServer) *mcp.ClientSession {
	t.Helper()

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

func newTestServer(t *testing.T, opts ...func(*Options)) *GraphQLSchemaServer {
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
	require.NoError(t, srv.Reload(&schemaDoc, nil))

	return srv
}

func TestDiscover_ReturnsConfiguredInstructions(t *testing.T) {
	const instructions = "Call list_employees before querying individual employees."

	srv := newTestServer(t, WithInstructions(instructions))
	cs := connectTestClient(t, srv)

	assert.Equal(t, instructions, cs.InitializeResult().Instructions)
}

func TestDiscover_NoInstructionsByDefault(t *testing.T) {
	srv := newTestServer(t)
	cs := connectTestClient(t, srv)

	assert.Empty(t, cs.InitializeResult().Instructions)
}

func TestDiscover_ServerInfoUsesConfiguredVersion(t *testing.T) {
	srv := newTestServer(t, WithServerVersion("1.2.3"))
	cs := connectTestClient(t, srv)

	serverInfo := cs.InitializeResult().ServerInfo
	require.NotNil(t, serverInfo)
	assert.Equal(t, "1.2.3", serverInfo.Version)
}
