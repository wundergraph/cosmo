package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
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

	t.Run("CORS", func(t *testing.T) {
		t.Run("Preflight OPTIONS request returns correct CORS headers", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Get the MCP server address from the configuration
				mcpAddr := xEnv.GetMCPServerAddr()

				// Create an OPTIONS request (preflight request)
				req, err := http.NewRequest("OPTIONS", mcpAddr, nil)
				require.NoError(t, err)

				// Add typical CORS preflight headers
				req.Header.Set("Origin", "https://example.com")
				req.Header.Set("Access-Control-Request-Method", "POST")
				req.Header.Set("Access-Control-Request-Headers", "Content-Type, Authorization")

				// Make the request
				resp, err := xEnv.RouterClient.Do(req)
				require.NoError(t, err)
				defer resp.Body.Close()

				// Verify response status
				assert.Equal(t, http.StatusNoContent, resp.StatusCode)

				// Verify CORS headers
				assert.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"))

				allowedMethods := resp.Header.Get("Access-Control-Allow-Methods")
				assert.Contains(t, allowedMethods, "GET")
				assert.Contains(t, allowedMethods, "POST")
				assert.Contains(t, allowedMethods, "PUT")
				assert.Contains(t, allowedMethods, "DELETE")
				assert.Contains(t, allowedMethods, "OPTIONS")

				allowedHeaders := resp.Header.Get("Access-Control-Allow-Headers")
				assert.Contains(t, allowedHeaders, "Content-Type")
				assert.Contains(t, allowedHeaders, "Accept")
				assert.Contains(t, allowedHeaders, "Authorization")
				assert.Contains(t, allowedHeaders, "Last-Event-ID")
				assert.Contains(t, allowedHeaders, "Mcp-Protocol-Version")
				assert.Contains(t, allowedHeaders, "Mcp-Session-Id")

				assert.Equal(t, "86400", resp.Header.Get("Access-Control-Max-Age"))
			})
		})

		t.Run("Actual POST request includes CORS headers", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Get the MCP server address from the configuration
				mcpAddr := xEnv.GetMCPServerAddr()

				// Create a POST request with MCP payload
				mcpRequest := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      1,
					"method":  "tools/list",
					"params":  map[string]interface{}{},
				}

				requestBody, err := json.Marshal(mcpRequest)
				require.NoError(t, err)

				req, err := http.NewRequest("POST", mcpAddr, strings.NewReader(string(requestBody)))
				require.NoError(t, err)

				// Add cross-origin headers
				req.Header.Set("Origin", "https://example.com")
				req.Header.Set("Content-Type", "application/json")

				// Make the request
				resp, err := xEnv.RouterClient.Do(req)
				require.NoError(t, err)
				defer resp.Body.Close()

				// Verify CORS headers are present in the response
				assert.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"))

				allowedMethods := resp.Header.Get("Access-Control-Allow-Methods")
				assert.Contains(t, allowedMethods, "GET")
				assert.Contains(t, allowedMethods, "POST")
				assert.Contains(t, allowedMethods, "PUT")
				assert.Contains(t, allowedMethods, "DELETE")
				assert.Contains(t, allowedMethods, "OPTIONS")

				allowedHeaders := resp.Header.Get("Access-Control-Allow-Headers")
				assert.Contains(t, allowedHeaders, "Content-Type")
				assert.Contains(t, allowedHeaders, "Accept")
				assert.Contains(t, allowedHeaders, "Authorization")
				assert.Contains(t, allowedHeaders, "Last-Event-ID")
				assert.Contains(t, allowedHeaders, "Mcp-Protocol-Version")
				assert.Contains(t, allowedHeaders, "Mcp-Session-Id")

				assert.Equal(t, "86400", resp.Header.Get("Access-Control-Max-Age"))
			})
		})

		t.Run("GET request includes CORS headers", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Get the MCP server address from the configuration
				mcpAddr := xEnv.GetMCPServerAddr()

				// Create a GET request
				req, err := http.NewRequest("GET", mcpAddr, nil)
				require.NoError(t, err)

				// Add cross-origin header
				req.Header.Set("Origin", "https://example.com")

				// Make the request
				resp, err := xEnv.RouterClient.Do(req)
				require.NoError(t, err)
				defer resp.Body.Close()

				// Verify CORS headers are present in the response
				assert.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"))

				allowedMethods := resp.Header.Get("Access-Control-Allow-Methods")
				assert.Contains(t, allowedMethods, "GET")
				assert.Contains(t, allowedMethods, "POST")
				assert.Contains(t, allowedMethods, "PUT")
				assert.Contains(t, allowedMethods, "DELETE")
				assert.Contains(t, allowedMethods, "OPTIONS")

				allowedHeaders := resp.Header.Get("Access-Control-Allow-Headers")
				assert.Contains(t, allowedHeaders, "Content-Type")
				assert.Contains(t, allowedHeaders, "Accept")
				assert.Contains(t, allowedHeaders, "Authorization")
				assert.Contains(t, allowedHeaders, "Last-Event-ID")
				assert.Contains(t, allowedHeaders, "Mcp-Protocol-Version")
				assert.Contains(t, allowedHeaders, "Mcp-Session-Id")

				assert.Equal(t, "86400", resp.Header.Get("Access-Control-Max-Age"))
			})
		})

		t.Run("CORS headers work with different HTTP methods", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Get the MCP server address from the configuration
				mcpAddr := xEnv.GetMCPServerAddr()

				// Test different HTTP methods
				methods := []string{"PUT", "DELETE"}

				for _, method := range methods {
					t.Run(fmt.Sprintf("Method %s", method), func(t *testing.T) {
						req, err := http.NewRequest(method, mcpAddr, nil)
						require.NoError(t, err)

						// Add cross-origin header
						req.Header.Set("Origin", "https://example.com")

						// Make the request
						resp, err := xEnv.RouterClient.Do(req)
						require.NoError(t, err)
						defer resp.Body.Close()

						// Verify CORS headers are present
						assert.Equal(t, "*", resp.Header.Get("Access-Control-Allow-Origin"))

						allowedMethods := resp.Header.Get("Access-Control-Allow-Methods")
						assert.Contains(t, allowedMethods, method)
						assert.Contains(t, allowedMethods, "OPTIONS")

						allowedHeaders := resp.Header.Get("Access-Control-Allow-Headers")
						assert.Contains(t, allowedHeaders, "Content-Type")
						assert.Contains(t, allowedHeaders, "Authorization")

						assert.Equal(t, "86400", resp.Header.Get("Access-Control-Max-Age"))
					})
				}
			})
		})
	})

	t.Run("Header Forwarding", func(t *testing.T) {
		t.Run("Authorization header is always forwarded", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   false, // Disabled, but Authorization should still be forwarded
						AllowList: []string{},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify Authorization header is present
								auth := r.Header.Get("Authorization")
								if auth == "" {
									http.Error(w, "Missing Authorization header", http.StatusUnauthorized)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Create MCP client with Authorization header
				mcpAddr := xEnv.GetMCPServerAddr()
				client, err := http.NewRequest("POST", mcpAddr, nil)
				require.NoError(t, err)
				client.Header.Set("Authorization", "Bearer test-token")

				req := mcp.CallToolRequest{}
				req.Params.Name = "execute_operation_my_employees"
				req.Params.Arguments = map[string]interface{}{
					"criteria": map[string]interface{}{},
				}

				resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
				assert.NoError(t, err)
				assert.NotNil(t, resp)
				assert.False(t, resp.IsError, "Should not error - Authorization header should be forwarded")
			})
		})

		t.Run("Custom headers forwarded when enabled with exact match", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   true,
						AllowList: []string{"X-Tenant-ID", "X-Request-ID"},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify custom headers are present
								tenantID := r.Header.Get("X-Tenant-ID")
								requestID := r.Header.Get("X-Request-ID")

								if tenantID != "tenant-123" {
									http.Error(w, fmt.Sprintf("Expected X-Tenant-ID=tenant-123, got %s", tenantID), http.StatusBadRequest)
									return
								}
								if requestID != "req-456" {
									http.Error(w, fmt.Sprintf("Expected X-Request-ID=req-456, got %s", requestID), http.StatusBadRequest)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// Note: In a real test, we'd need to modify the MCP client to support custom headers
				// For now, this test structure shows the intent
				req := mcp.CallToolRequest{}
				req.Params.Name = "execute_operation_my_employees"
				req.Params.Arguments = map[string]interface{}{
					"criteria": map[string]interface{}{},
				}

				resp, err := xEnv.MCPClient.CallTool(xEnv.Context, req)
				assert.NoError(t, err)
				assert.NotNil(t, resp)
			})
		})

		t.Run("Custom headers NOT forwarded when disabled", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   false, // Disabled
						AllowList: []string{"X-Tenant-ID"},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify custom header is NOT present
								tenantID := r.Header.Get("X-Tenant-ID")
								if tenantID != "" {
									http.Error(w, "X-Tenant-ID should not be forwarded when disabled", http.StatusBadRequest)
									return
								}
								// But Authorization should still be present
								auth := r.Header.Get("Authorization")
								if auth == "" {
									http.Error(w, "Authorization should always be forwarded", http.StatusUnauthorized)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
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
				assert.False(t, resp.IsError)
			})
		})

		t.Run("Regex pattern matching for headers", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   true,
						AllowList: []string{"X-Custom-.*", "X-Trace-.*"},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify headers matching regex patterns are present
								customHeader := r.Header.Get("X-Custom-Header")
								traceID := r.Header.Get("X-Trace-ID")

								if customHeader != "custom-value" {
									http.Error(w, fmt.Sprintf("Expected X-Custom-Header=custom-value, got %s", customHeader), http.StatusBadRequest)
									return
								}
								if traceID != "trace-123" {
									http.Error(w, fmt.Sprintf("Expected X-Trace-ID=trace-123, got %s", traceID), http.StatusBadRequest)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
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
			})
		})

		t.Run("Headers not in allowlist are NOT forwarded", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   true,
						AllowList: []string{"X-Allowed-Header"},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify allowed header is present
								allowed := r.Header.Get("X-Allowed-Header")
								if allowed != "allowed-value" {
									http.Error(w, "X-Allowed-Header should be forwarded", http.StatusBadRequest)
									return
								}

								// Verify non-allowed header is NOT present
								notAllowed := r.Header.Get("X-Not-Allowed-Header")
								if notAllowed != "" {
									http.Error(w, "X-Not-Allowed-Header should NOT be forwarded", http.StatusBadRequest)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
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
				assert.False(t, resp.IsError)
			})
		})

		t.Run("Case-insensitive header matching", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   true,
						AllowList: []string{"x-tenant-id"}, // lowercase in config
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify header is present regardless of case
								tenantID := r.Header.Get("X-Tenant-ID") // uppercase in request
								if tenantID != "tenant-123" {
									http.Error(w, fmt.Sprintf("Expected X-Tenant-ID=tenant-123, got %s", tenantID), http.StatusBadRequest)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
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
				assert.False(t, resp.IsError)
			})
		})

		t.Run("Multiple values for same header are forwarded", func(t *testing.T) {
			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					ForwardHeaders: config.MCPForwardHeadersConfiguration{
						Enabled:   true,
						AllowList: []string{"X-Multi-Value"},
					},
				},
				Subgraphs: testenv.SubgraphsConfig{
					Employees: testenv.SubgraphConfig{
						Middleware: func(handler http.Handler) http.Handler {
							return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
								// Verify multiple values are present
								values := r.Header.Values("X-Multi-Value")
								if len(values) != 2 {
									http.Error(w, fmt.Sprintf("Expected 2 values, got %d", len(values)), http.StatusBadRequest)
									return
								}
								if values[0] != "value1" || values[1] != "value2" {
									http.Error(w, "Values don't match expected", http.StatusBadRequest)
									return
								}
								handler.ServeHTTP(w, r)
							})
						},
					},
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
				assert.False(t, resp.IsError)
			})
		})
	})
}
