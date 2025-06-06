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
					Name:        "get_operation_info",
					Description: "Provides instructions on how to execute the GraphQL operation via HTTP and how to integrate it into your application.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{"operationName": map[string]interface{}{"description": "The exact name of the GraphQL operation to retrieve information for.", "enum": []interface{}{"UpdateMood", "MyEmployees"}, "type": "string"}},
						Required:   []string{"operationName"}},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:        "Get GraphQL Operation Info",
						ReadOnlyHint: mcp.ToBoolPtr(true),
					},
				})
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
				require.NotNil(t, resp)

				// Verify get_schema tool with proper schema
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "get_schema",
					Description: "Provides the full GraphQL schema of the API.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{},
						Required:   []string(nil),
					},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:        "Get GraphQL Schema",
						ReadOnlyHint: mcp.ToBoolPtr(true),
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
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:           "Execute GraphQL Query",
						DestructiveHint: mcp.ToBoolPtr(true),
						OpenWorldHint:   mcp.ToBoolPtr(true),
						IdempotentHint:  mcp.ToBoolPtr(false),
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
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{"criteria": map[string]interface{}{"additionalProperties": false, "description": "Allows to filter employees by their details.", "nullable": false, "properties": map[string]interface{}{"hasPets": map[string]interface{}{"nullable": true, "type": "boolean"}, "nationality": map[string]interface{}{"enum": []interface{}{"AMERICAN", "DUTCH", "ENGLISH", "GERMAN", "INDIAN", "SPANISH", "UKRAINIAN"}, "nullable": true, "type": "string"}, "nested": map[string]interface{}{"additionalProperties": false, "nullable": true, "properties": map[string]interface{}{"hasChildren": map[string]interface{}{"nullable": true, "type": "boolean"}, "maritalStatus": map[string]interface{}{"enum": []interface{}{"ENGAGED", "MARRIED"}, "nullable": true, "type": "string"}}, "type": "object"}}, "type": "object"}},
						Required:   []string(nil)},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:          "Execute operation MyEmployees",
						ReadOnlyHint:   mcp.ToBoolPtr(true),
						IdempotentHint: mcp.ToBoolPtr(true),
						OpenWorldHint:  mcp.ToBoolPtr(true),
					},
				})

				// Verify UpdateMood operation
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_operation_update_mood",
					Description: "Executes the GraphQL operation 'UpdateMood' of type mutation. This mutation update the mood of an employee.",
					InputSchema: mcp.ToolInputSchema{Type: "object", Properties: map[string]interface{}{"employeeID": map[string]interface{}{"type": "integer"}, "mood": map[string]interface{}{"enum": []interface{}{"HAPPY", "SAD"}, "type": "string"}}, Required: []string{"employeeID", "mood"}}, RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:          "Execute operation UpdateMood",
						OpenWorldHint:  mcp.ToBoolPtr(true),
						ReadOnlyHint:   mcp.ToBoolPtr(false),
						IdempotentHint: mcp.ToBoolPtr(false),
					},
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
						Enabled:   true,
						RouterURL: "https://api.example.com/graphql",
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

					// Set up expected text with the static endpoint
					expectedContent := "Operation: MyEmployees\nType: query\nDescription: This is a GraphQL query that retrieves a list of employees.\n\nInput Schema:\n```json\n{\"additionalProperties\":false,\"description\":\"This is a GraphQL query that retrieves a list of employees.\",\"nullable\":true,\"properties\":{\"criteria\":{\"additionalProperties\":false,\"description\":\"Allows to filter employees by their details.\",\"nullable\":false,\"properties\":{\"hasPets\":{\"nullable\":true,\"type\":\"boolean\"},\"nationality\":{\"enum\":[\"AMERICAN\",\"DUTCH\",\"ENGLISH\",\"GERMAN\",\"INDIAN\",\"SPANISH\",\"UKRAINIAN\"],\"nullable\":true,\"type\":\"string\"},\"nested\":{\"additionalProperties\":false,\"nullable\":true,\"properties\":{\"hasChildren\":{\"nullable\":true,\"type\":\"boolean\"},\"maritalStatus\":{\"enum\":[\"ENGAGED\",\"MARRIED\"],\"nullable\":true,\"type\":\"string\"}},\"type\":\"object\"}},\"type\":\"object\"}},\"type\":\"object\"}\n```\n\nGraphQL Query:\n```\nquery MyEmployees($criteria: SearchInput) {\n    findEmployees(criteria: $criteria) {\n        id\n        isAvailable\n        currentMood\n        products\n        details {\n            forename\n            nationality\n        }\n    }\n}\n```\n\nUsage Instructions:\n1. Endpoint: https://api.example.com/graphql\n2. HTTP Method: POST\n3. Headers Required:\n   - Content-Type: application/json; charset=utf-8\n\nRequest Format:\n```json\n{\n  \"query\": \"<operation_query>\",\n  \"variables\": <your_variables_object>\n}\n```\n\nImportant Notes:\n1. Use the query string exactly as provided above\n2. Do not modify or reformat the query string"

					assert.Equal(t, expectedContent, content.Text)
				})
			})

			t.Run("Execute Query", func(t *testing.T) {
				t.Run("Execute operation of type query with valid input", func(t *testing.T) {
					testenv.Run(t, &testenv.Config{
						EnableNats: true,
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
						EnableNats: true,
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
	})
}
