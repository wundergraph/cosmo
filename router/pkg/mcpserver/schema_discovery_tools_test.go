package mcpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"

	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/yoko/v1"
	"github.com/wundergraph/cosmo/router/gen/proto/yoko/v1/yokov1connect"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// testSchemaDoc parses the shared test schema.
func testSchemaDoc(t *testing.T) *ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(testSchema)
	require.False(t, report.HasErrors())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))
	return &doc
}

// callToolRequest builds a tool call with the given JSON arguments.
func callToolRequest(t *testing.T, args string) *mcp.CallToolRequest {
	t.Helper()
	return &mcp.CallToolRequest{
		Params: &mcp.CallToolParamsRaw{Arguments: []byte(args)},
	}
}

// discoveryStub is a minimal stand-in for the discovery service.
type discoveryStub struct {
	yokov1connect.UnimplementedYokoServiceHandler
	ready bool
}

func (d *discoveryStub) EnsureIndex(_ context.Context, req *connect.Request[yokov1.EnsureIndexRequest]) (*connect.Response[yokov1.EnsureIndexResponse], error) {
	status := yokov1.IndexStatus_INDEX_STATUS_INDEXING
	if d.ready {
		status = yokov1.IndexStatus_INDEX_STATUS_READY
	}
	return connect.NewResponse(&yokov1.EnsureIndexResponse{
		Index: &yokov1.Index{IndexId: "sha256:" + testHash, Status: status},
	}), nil
}

func (d *discoveryStub) GetIndex(_ context.Context, req *connect.Request[yokov1.GetIndexRequest]) (*connect.Response[yokov1.GetIndexResponse], error) {
	return connect.NewResponse(&yokov1.GetIndexResponse{
		Index: &yokov1.Index{IndexId: req.Msg.GetIndexId(), Status: yokov1.IndexStatus_INDEX_STATUS_INDEXING},
	}), nil
}

const testHash = "0000000000000000000000000000000000000000000000000000000000000000"

// startDiscoveryStub starts a stub service and returns its URL.
func startDiscoveryStub(t *testing.T, ready bool) string {
	t.Helper()
	mux := http.NewServeMux()
	mux.Handle(yokov1connect.NewYokoServiceHandler(&discoveryStub{ready: ready}))
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

func TestSchemaDiscovery_ToolsAppearOnlyWhenEnabled(t *testing.T) {
	t.Run("disabled registers no discovery tool", func(t *testing.T) {
		s, err := NewGraphQLSchemaServer(context.Background(), "http://localhost:3002/graphql",
			WithOperationsDir(t.TempDir()))
		require.NoError(t, err)
		t.Cleanup(func() { s.cancel() })

		require.NoError(t, s.Reload(testSchemaDoc(t), nil))

		for _, name := range schemaDiscoveryToolNames {
			assert.NotContains(t, s.registeredTools, name)
		}
	})

	t.Run("enabled registers all three tools", func(t *testing.T) {
		s, err := NewGraphQLSchemaServer(context.Background(), "http://localhost:3002/graphql",
			WithOperationsDir(t.TempDir()),
			WithSchemaDiscovery(&config.MCPSchemaDiscoveryConfiguration{
				Enabled: true,
				URL:     startDiscoveryStub(t, true),
			}),
		)
		require.NoError(t, err)
		t.Cleanup(func() { s.cancel() })

		require.NoError(t, s.Reload(testSchemaDoc(t), nil))

		for _, name := range schemaDiscoveryToolNames {
			assert.Contains(t, s.registeredTools, name)
		}
	})
}

func TestSchemaDiscovery_MissingURLFailsAtStartup(t *testing.T) {
	// A server whose tools always fail is worse than a server that does not
	// start.
	_, err := NewGraphQLSchemaServer(context.Background(), "http://localhost:3002/graphql",
		WithSchemaDiscovery(&config.MCPSchemaDiscoveryConfiguration{Enabled: true}),
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no url is configured")
}

func TestSchemaDiscovery_NotReadyReturnsRetryText(t *testing.T) {
	s, err := NewGraphQLSchemaServer(context.Background(), "http://localhost:3002/graphql",
		WithOperationsDir(t.TempDir()),
		WithSchemaDiscovery(&config.MCPSchemaDiscoveryConfiguration{
			Enabled:           true,
			URL:               startDiscoveryStub(t, false),
			IndexPollInterval: time.Hour, // never finishes during the test
		}),
	)
	require.NoError(t, err)
	t.Cleanup(func() { s.cancel() })

	require.NoError(t, s.Reload(testSchemaDoc(t), nil))

	res, err := s.handleGenerateQuery()(context.Background(), callToolRequest(t, `{"prompt":"anything"}`))
	require.NoError(t, err, "a not ready index is a tool result, not a protocol error")
	require.True(t, res.IsError)

	text, ok := res.Content[0].(*mcp.TextContent)
	require.True(t, ok)
	assert.Contains(t, text.Text, "Retry in a few seconds")
}

func TestSchemaDiscovery_WriteTimeoutCoversGeneration(t *testing.T) {
	// Query generation takes 10 to 30 seconds. The HTTP write timeout must
	// exceed the request timeout, or the router cuts off its own response.
	t.Run("disabled keeps the default", func(t *testing.T) {
		s := &GraphQLSchemaServer{}
		assert.Equal(t, defaultWriteTimeout, s.writeTimeout())
	})

	t.Run("enabled raises above the request timeout", func(t *testing.T) {
		s := &GraphQLSchemaServer{schemaDiscoveryRequestTimeout: 90 * time.Second}
		assert.Greater(t, s.writeTimeout(), 90*time.Second)
	})

	t.Run("a short request timeout keeps the default floor", func(t *testing.T) {
		s := &GraphQLSchemaServer{schemaDiscoveryRequestTimeout: 5 * time.Second}
		assert.Equal(t, defaultWriteTimeout, s.writeTimeout())
	})
}
