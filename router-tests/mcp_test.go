package integration

import (
	"encoding/json"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestMCP(t *testing.T) {

	t.Run("Discovery", func(t *testing.T) {
		t.Run("List default discovery Tools", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				require.NoError(t, err)
				require.NotNil(t, resp)

				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "list_operations",
					Description: "Lists all available GraphQL operations.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}(nil), Required: []string(nil),
					},
					RawInputSchema: json.RawMessage(nil),
					Annotations:    mcp.ToolAnnotation{},
				})

				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "get_operation_info",
					Description: "Retrieve comprehensive metadata and execution details for a specific GraphQL operation by its name. Use this to collect all required information needed to execute the operation via execute_operation_<operation_name>.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{"operationName": map[string]interface{}{"description": "The exact name of the GraphQL operation to retrieve information for.", "type": "string"}},
						Required:   []string{"operationName"}},
					RawInputSchema: json.RawMessage(nil)},
				)
			})
		})

		t.Run("List optional discovery tools", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,

					ExposeSchema:              true,
					EnableArbitraryOperations: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				require.NoError(t, err)
				require.NotNil(t, resp)

				// Verify get_schema tool with proper schema
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:           "get_schema",
					Description:    "Use this function to obtain the full introspection-based schema of the GraphQL API. This is useful for understanding the structure, available types, queries, mutations, and overall capabilities of the API.",
					InputSchema:    mcp.ToolInputSchema{Type: "object", Properties: map[string]interface{}(nil), Required: []string(nil)},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:           "",
						ReadOnlyHint:    false,
						DestructiveHint: false,
						IdempotentHint:  false,
						OpenWorldHint:   false,
					},
				})

				// Verify execute tool with proper schema
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_graphql",
					Description: "Executes a GraphQL query or mutation.",
					InputSchema: mcp.ToolInputSchema{
						Type: "object",
						Properties: map[string]interface{}{
							"query": map[string]interface{}{
								"type":        "string",
								"description": "The GraphQL query or mutation string to execute.",
							},
							"variables": map[string]interface{}{
								"type":                 "object",
								"additionalProperties": true,
								"description":          "The variables to pass to the GraphQL query as a JSON object.",
							},
						},
						Required: []string{"query"},
					},
				})

			})
		})

		t.Run("List User Operations", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				// Test ListTools
				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				require.NoError(t, err)
				require.NotNil(t, resp)

				// Verify MyEmployees operation
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_operation_my_employees",
					Description: "Executes the GraphQL operation 'MyEmployees' of type query. This is a GraphQL query that retrieves a list of employees.",
					InputSchema: mcp.ToolInputSchema{Type: "object", Properties: map[string]interface{}{"criteria": map[string]interface{}{"additionalProperties": false, "description": "Allows to filter employees by their details.", "nullable": false, "properties": map[string]interface{}{"hasPets": map[string]interface{}{"nullable": true, "type": "boolean"}, "nationality": map[string]interface{}{"enum": []interface{}{"AMERICAN", "DUTCH", "ENGLISH", "GERMAN", "INDIAN", "SPANISH", "UKRAINIAN"}, "nullable": true, "type": "string"}, "nested": map[string]interface{}{"additionalProperties": false, "nullable": true, "properties": map[string]interface{}{"hasChildren": map[string]interface{}{"nullable": true, "type": "boolean"}, "maritalStatus": map[string]interface{}{"enum": []interface{}{"ENGAGED", "MARRIED"}, "nullable": true, "type": "string"}}, "type": "object"}}, "type": "object"}},
						Required: []string(nil)},
					RawInputSchema: json.RawMessage(nil),
					Annotations:    mcp.ToolAnnotation{},
				})

				// Verify UpdateMood operation
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_operation_update_mood",
					Description: "Executes the GraphQL operation 'UpdateMood' of type mutation. This mutation update the mood of an employee.",
					InputSchema: mcp.ToolInputSchema{Type: "object", Properties: map[string]interface{}{"employeeID": map[string]interface{}{"type": "integer"}, "mood": map[string]interface{}{"enum": []interface{}{"HAPPY", "SAD"}, "type": "string"}},
						Required: []string{"employeeID", "mood"}},
					RawInputSchema: json.RawMessage(nil)},
				)
			})
		})

		t.Run("List user Operations / Static operations of type mutation aren't exposed when excludeMutations is set", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled:          true,
					ExcludeMutations: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				require.NoError(t, err)
				require.NotNil(t, resp)

				found := false
				for _, tool := range resp.Tools {
					if tool.Name == "execute_operation_update_mood" {
						found = true
						break
					}
				}

				require.False(t, found, "Tool execute_operation_update_mood should not be found")

			})
		})

		t.Run("Execute Operation Info", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {

				req := mcp.CallToolRequest{}
				req.Params.Name = "get_operation_info"
				req.Params.Arguments = map[string]interface{}{
					"operationName": "MyEmployees",
				}

				resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
				assert.NoError(t, err)
				assert.NotNil(t, resp)

				assert.Len(t, resp.Content, 1)
				content, ok := resp.Content[0].(mcp.TextContent)
				assert.True(t, ok)

				assert.Equal(t, content.Type, "text")
				assert.NotEmpty(t, content.Text)
			})
		})

		t.Run("Execute Query", func(t *testing.T) {
			t.Run("Execute operation of type query with valid input", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					MCP: config.MCPConfiguration{
						Enabled: true,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {

					req := mcp.CallToolRequest{}
					req.Params.Name = "execute_operation_my_employees"
					req.Params.Arguments = map[string]interface{}{
						"criteria": map[string]interface{}{},
					}

					resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
					assert.NoError(t, err)
					assert.NotNil(t, resp)

					assert.Len(t, resp.Content, 1)

					content, ok := resp.Content[0].(mcp.TextContent)
					assert.True(t, ok)

					assert.Equal(t, content.Type, "text")
					assert.Nil(t, content.Annotations)
					assert.Equal(t, "{\"data\":{\"findEmployees\":[{\"id\":1,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"CONSULTANCY\",\"COSMO\",\"ENGINE\",\"MARKETING\",\"SDK\"],\"details\":{\"forename\":\"Jens\",\"nationality\":\"GERMAN\"}},{\"id\":2,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"COSMO\",\"SDK\"],\"details\":{\"forename\":\"Dustin\",\"nationality\":\"GERMAN\"}},{\"id\":3,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"CONSULTANCY\",\"MARKETING\"],\"details\":{\"forename\":\"Stefan\",\"nationality\":\"AMERICAN\"}},{\"id\":4,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"FINANCE\",\"HUMAN_RESOURCES\",\"MARKETING\"],\"details\":{\"forename\":\"Björn\",\"nationality\":\"GERMAN\"}},{\"id\":5,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"ENGINE\",\"SDK\"],\"details\":{\"forename\":\"Sergiy\",\"nationality\":\"UKRAINIAN\"}},{\"id\":7,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"COSMO\",\"SDK\"],\"details\":{\"forename\":\"Suvij\",\"nationality\":\"INDIAN\"}},{\"id\":8,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"COSMO\",\"SDK\"],\"details\":{\"forename\":\"Nithin\",\"nationality\":\"INDIAN\"}},{\"id\":10,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"CONSULTANCY\",\"COSMO\",\"SDK\"],\"details\":{\"forename\":\"Eelco\",\"nationality\":\"DUTCH\"}},{\"id\":11,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"FINANCE\"],\"details\":{\"forename\":\"Alexandra\",\"nationality\":\"GERMAN\"}},{\"id\":12,\"isAvailable\":false,\"currentMood\":\"HAPPY\",\"products\":[\"CONSULTANCY\",\"COSMO\",\"ENGINE\",\"SDK\"],\"details\":{\"forename\":\"David\",\"nationality\":\"ENGLISH\"}}]}}", content.Text)

				})
			})

			t.Run("Execute operation of type query with invalid input", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					MCP: config.MCPConfiguration{
						Enabled: true,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {

					req := mcp.CallToolRequest{}
					req.Params.Name = "execute_operation_my_employees"
					req.Params.Arguments = map[string]interface{}{
						"criteria": nil,
					}

					resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
					assert.NoError(t, err)
					assert.True(t, resp.IsError)

					content, ok := resp.Content[0].(mcp.TextContent)
					assert.True(t, ok)

					assert.Equal(t, content.Type, "text")
					assert.Equal(t, content.Text, "Input validation Error: validation error: at '/criteria': got null, want object")
				})
			})
		})

		t.Run("Execute Mutation", func(t *testing.T) {
			t.Run("Execute operation of type mutation with valid input", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					MCP: config.MCPConfiguration{
						Enabled: true,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {

					req := mcp.CallToolRequest{}
					req.Params.Name = "execute_operation_update_mood"
					req.Params.Arguments = map[string]interface{}{
						"employeeID": 1,
						"mood":       "HAPPY",
					}

					resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
					assert.NoError(t, err)
					assert.NotNil(t, resp)

					assert.Len(t, resp.Content, 1)

					content, ok := resp.Content[0].(mcp.TextContent)
					assert.True(t, ok)

					assert.Equal(t, content.Type, "text")
					assert.Nil(t, content.Annotations)
					assert.Equal(t, "{\"data\":{\"updateMood\":{\"id\":1,\"details\":{\"forename\":\"Jens\"},\"currentMood\":\"HAPPY\"}}}", content.Text)
				})
			})
		})

		t.Run("Developer Tools", func(t *testing.T) {
			t.Run("Execute an arbitrary query", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					MCP: config.MCPConfiguration{
						Enabled:                   true,
						EnableArbitraryOperations: true,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {

					req := mcp.CallToolRequest{}
					req.Params.Name = "execute_graphql"
					req.Params.Arguments = map[string]interface{}{
						"query": `
							query {
							  employees {
								id
							  }
							}
							`,
					}

					resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
					assert.NoError(t, err)
					assert.NotNil(t, resp)

					assert.Len(t, resp.Content, 1)

					content, ok := resp.Content[0].(mcp.TextContent)
					assert.True(t, ok)

					assert.Equal(t, content.Type, "text")
					assert.Nil(t, content.Annotations)
					assert.Equal(t, "{\"data\":{\"employees\":[{\"id\":1},{\"id\":2},{\"id\":3},{\"id\":4},{\"id\":5},{\"id\":7},{\"id\":8},{\"id\":10},{\"id\":11},{\"id\":12}]}}", content.Text)

				})
			})

			t.Run("Get the full graph schema of the base graph", func(t *testing.T) {
				testenv.Run(t, &testenv.Config{
					MCP: config.MCPConfiguration{
						Enabled:      true,
						ExposeSchema: true,
					},
				}, func(t *testing.T, xEnv *testenv.Environment) {

					req := mcp.CallToolRequest{}
					req.Params.Name = "get_schema"

					resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
					assert.NoError(t, err)
					assert.NotNil(t, resp)

					assert.Len(t, resp.Content, 1)

					content, ok := resp.Content[0].(mcp.TextContent)
					assert.True(t, ok)

					assert.Equal(t, content.Type, "text")
					assert.Nil(t, content.Annotations)
					assert.Contains(t, content.Text, "schema {")
				})
			})
		})

	})
}
