package integration

import (
	"encoding/json"
	"testing"

	sdkmcp "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/mcpserver"
)

// connectSDKClient connects an official go-sdk MCP client to the test router.
func connectSDKClient(t *testing.T, xEnv *testenv.Environment) *sdkmcp.ClientSession {
	t.Helper()
	client := sdkmcp.NewClient(&sdkmcp.Implementation{Name: "resources-test", Version: "1.0.0"}, nil)
	session, err := client.Connect(xEnv.Context, &sdkmcp.StreamableClientTransport{
		Endpoint: xEnv.GetMCPServerAddr(),
	}, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func TestMCPResources(t *testing.T) {
	t.Run("resources are listed and readable", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCPOperationsPath: "testdata/mcp_resources",
			MCP: config.MCPConfiguration{
				Enabled:   true,
				Resources: config.MCPResourcesConfiguration{Enabled: true},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			session := connectSDKClient(t, xEnv)

			// Discovery instructions are appended when resources are enabled.
			assert.Contains(t, session.InitializeResult().Instructions, "get_context")

			listed, err := session.ListResources(xEnv.Context, &sdkmcp.ListResourcesParams{})
			require.NoError(t, err)

			uris := make([]string, 0, len(listed.Resources))
			for _, r := range listed.Resources {
				uris = append(uris, r.URI)
			}
			assert.ElementsMatch(t, []string{
				"context:///usage.md",
				"skill://trip-planning/SKILL.md",
				"skill://trip-planning/examples.md",
				// The skill directory serves every regular file under it as
				// a resource, including the .graphql fixture that proves
				// skill-internal operations are excluded from tool
				// registration (see the "skill graphql files are not
				// registered as tools" subtest below).
				"skill://trip-planning/Example.graphql",
			}, uris)

			read, err := session.ReadResource(xEnv.Context, &sdkmcp.ReadResourceParams{
				URI: "skill://trip-planning/SKILL.md",
			})
			require.NoError(t, err)
			require.Len(t, read.Contents, 1)
			assert.Equal(t, "text/markdown", read.Contents[0].MIMEType)
			assert.Contains(t, read.Contents[0].Text, "name: trip-planning")
			assert.Contains(t, read.Contents[0].Text, "# Trip planning")
		})
	})

	t.Run("skill graphql files are not registered as tools", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCPOperationsPath: "testdata/mcp_resources",
			MCP: config.MCPConfiguration{
				Enabled:   true,
				Resources: config.MCPResourcesConfiguration{Enabled: true},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			session := connectSDKClient(t, xEnv)

			tools, err := session.ListTools(xEnv.Context, &sdkmcp.ListToolsParams{})
			require.NoError(t, err)

			names := make([]string, 0, len(tools.Tools))
			for _, tool := range tools.Tools {
				names = append(names, tool.Name)
			}
			assert.Contains(t, names, "execute_operation_my_employees")
			assert.Contains(t, names, "get_context")
			assert.NotContains(t, names, "execute_operation_skill_example")
		})
	})

	t.Run("get_context returns index and content", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCPOperationsPath: "testdata/mcp_resources",
			MCP: config.MCPConfiguration{
				Enabled:   true,
				Resources: config.MCPResourcesConfiguration{Enabled: true},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			session := connectSDKClient(t, xEnv)

			indexResult, err := session.CallTool(xEnv.Context, &sdkmcp.CallToolParams{
				Name:      "get_context",
				Arguments: map[string]any{},
			})
			require.NoError(t, err)
			require.False(t, indexResult.IsError)

			var index mcpserver.ContextIndex
			text := indexResult.Content[0].(*sdkmcp.TextContent).Text
			require.NoError(t, json.Unmarshal([]byte(text), &index))
			require.Len(t, index.Skills, 1)
			assert.Equal(t, "trip-planning", index.Skills[0].Name)
			require.Len(t, index.Documents, 1)
			assert.Equal(t, "context:///usage.md", index.Documents[0].URI)

			docResult, err := session.CallTool(xEnv.Context, &sdkmcp.CallToolParams{
				Name:      "get_context",
				Arguments: map[string]any{"uri": "context:///usage.md"},
			})
			require.NoError(t, err)
			require.False(t, docResult.IsError)
			assert.Contains(t, docResult.Content[0].(*sdkmcp.TextContent).Text, "# API Usage")
		})
	})

	t.Run("disabled by default", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCPOperationsPath: "testdata/mcp_resources",
			MCP: config.MCPConfiguration{
				Enabled: true,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			session := connectSDKClient(t, xEnv)

			tools, err := session.ListTools(xEnv.Context, &sdkmcp.ListToolsParams{})
			require.NoError(t, err)
			for _, tool := range tools.Tools {
				assert.NotEqual(t, "get_context", tool.Name)
			}

			// The initialize result must not advertise the resources capability.
			caps := session.InitializeResult().Capabilities
			assert.Nil(t, caps.Resources)
		})
	})
}
