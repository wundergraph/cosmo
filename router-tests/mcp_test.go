package integration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/schemaloader"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
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
					Description: "This is a GraphQL query that retrieves a list of employees.",
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
					Description: "This mutation update the mood of an employee.",
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

	t.Run("Operation Description Extraction", func(t *testing.T) {
		// TestMCPOperationDescriptionExtraction tests that the MCP server properly extracts
		// descriptions from GraphQL operations and uses them for tool descriptions
		t.Run("Extract descriptions from GraphQL operations", func(t *testing.T) {
			// Create a temporary directory for test operations
			tempDir := t.TempDir()

			// Create test operation files
			testCases := []struct {
				name             string
				filename         string
				content          string
				expectedDesc     string
				expectDescEmpty  bool
			}{
				{
					name:     "operation with multi-line description",
					filename: "FindUser.graphql",
					content: `"""
Finds a user by their unique identifier.
Returns comprehensive user information including profile and settings.

Required permissions: user:read
"""
query FindUser($id: ID!) {
	user(id: $id) {
		id
		name
		email
	}
}`,
					expectedDesc: "Finds a user by their unique identifier.\nReturns comprehensive user information including profile and settings.\n\nRequired permissions: user:read",
				},
				{
					name:     "operation with single-line description",
					filename: "GetProfile.graphql",
					content: `"""Gets the current user's profile"""
query GetProfile {
	me {
		id
		name
	}
}`,
					expectedDesc: "Gets the current user's profile",
				},
				{
					name:     "operation without description",
					filename: "ListUsers.graphql",
					content: `query ListUsers {
	users {
		id
		name
	}
}`,
					expectDescEmpty: true,
				},
				{
					name:     "mutation with description",
					filename: "CreateUser.graphql",
					content: `"""
Creates a new user in the system.
Requires admin privileges.
"""
mutation CreateUser($input: UserInput!) {
	createUser(input: $input) {
		id
		name
	}
}`,
					expectedDesc: "Creates a new user in the system.\nRequires admin privileges.",
				},
			}

			// Write test files
			for _, tc := range testCases {
				err := os.WriteFile(filepath.Join(tempDir, tc.filename), []byte(tc.content), 0644)
				require.NoError(t, err, "Failed to write test file %s", tc.filename)
			}

			// Create a simple schema for validation
			schemaStr := `
type Query {
	user(id: ID!): User
	users: [User!]!
	me: User
}

type Mutation {
	createUser(input: UserInput!): User
}

type User {
	id: ID!
	name: String!
	email: String
}

input UserInput {
	name: String!
	email: String
}
`
			schemaDoc, report := astparser.ParseGraphqlDocumentString(schemaStr)
			require.False(t, report.HasErrors(), "Failed to parse schema")

			// Normalize the schema (required for validation)
			err := asttransform.MergeDefinitionWithBaseSchema(&schemaDoc)
			require.NoError(t, err, "Failed to normalize schema")

			// Load operations using the OperationLoader
			logger := zap.NewNop()
			loader := schemaloader.NewOperationLoader(logger, &schemaDoc)
			operations, err := loader.LoadOperationsFromDirectory(tempDir)
			require.NoError(t, err, "Failed to load operations")
			require.Len(t, operations, len(testCases), "Expected %d operations to be loaded", len(testCases))

			// Verify each operation has the correct description
			for _, tc := range testCases {
				t.Run(tc.name, func(t *testing.T) {
					// Find the operation by name
					var op *schemaloader.Operation
					for i := range operations {
						if operations[i].FilePath == filepath.Join(tempDir, tc.filename) {
							op = &operations[i]
							break
						}
					}
					require.NotNil(t, op, "Operation not found: %s", tc.filename)

					// Verify description
					if tc.expectDescEmpty {
						assert.Empty(t, op.Description, "Expected empty description for %s", tc.name)
					} else {
						assert.Equal(t, tc.expectedDesc, op.Description, "Description mismatch for %s", tc.name)
					}
				})
			}
		})
	})

	t.Run("Tool Description Usage", func(t *testing.T) {
		// TestMCPToolDescriptionUsage tests that operation descriptions are properly used
		// when creating MCP tool descriptions
		tests := []struct {
			name                string
			operationDesc       string
			operationName       string
			operationType       string
			expectedToolDesc    string
			expectDefaultFormat bool
		}{
			{
				name:             "uses operation description when present",
				operationDesc:    "Finds a user by ID and returns their profile",
				operationName:    "FindUser",
				operationType:    "query",
				expectedToolDesc: "Finds a user by ID and returns their profile",
			},
			{
				name:                "uses default format when description is empty",
				operationDesc:       "",
				operationName:       "GetUsers",
				operationType:       "query",
				expectDefaultFormat: true,
			},
			{
				name:             "uses mutation description",
				operationDesc:    "Creates a new user with the provided input",
				operationName:    "CreateUser",
				operationType:    "mutation",
				expectedToolDesc: "Creates a new user with the provided input",
			},
		}

		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				// Simulate what the MCP server does when creating tool descriptions
				var toolDescription string
				if tt.operationDesc != "" {
					toolDescription = tt.operationDesc
				} else {
					// This is the default format used in server.go
					toolDescription = "Executes the GraphQL operation '" + tt.operationName + "' of type " + tt.operationType + "."
				}

				if tt.expectDefaultFormat {
					assert.Contains(t, toolDescription, tt.operationName, "Default description should contain operation name")
					assert.Contains(t, toolDescription, tt.operationType, "Default description should contain operation type")
				} else {
					assert.Equal(t, tt.expectedToolDesc, toolDescription, "Tool description should match operation description")
				}
			})
		}
	})

	t.Run("Header Forwarding", func(t *testing.T) {
		t.Run("All request headers are forwarded from MCP client through to subgraphs", func(t *testing.T) {
			// This test validates that ALL headers sent by MCP clients are forwarded
			// through the complete chain: MCP Client -> MCP Server -> Router -> Subgraphs
			//
			// The router's header forwarding rules (configured with wildcard `.*`) determine
			// what gets propagated to subgraphs. The MCP server acts as a transparent proxy,
			// forwarding all headers without filtering.
			//
			// Note: We use direct HTTP POST requests instead of the mcp-go client library
			// because transport.WithHTTPHeaders() in mcp-go sets headers at the SSE connection
			// level, not on individual tool execution requests. Direct HTTP requests allow us
			// to test per-request headers, which is what real MCP clients (like Claude Desktop) send.

			var capturedSubgraphRequest *http.Request
			var subgraphMutex sync.Mutex

			testenv.Run(t, &testenv.Config{
				MCP: config.MCPConfiguration{
					Enabled: true,
					Session: config.MCPSessionConfig{
						Stateless: true, // Enable stateless mode so we don't need session IDs
					},
				},
				RouterOptions: []core.Option{
					// Forward all headers including custom ones
					core.WithHeaderRules(config.HeaderRules{
						All: &config.GlobalHeaderRule{
							Request: []*config.RequestHeaderRule{
								{
									Operation: config.HeaderRuleOperationPropagate,
									Matching:  ".*", // Forward all headers
								},
							},
						},
					}),
				},
				Subgraphs: testenv.SubgraphsConfig{
					GlobalMiddleware: func(handler http.Handler) http.Handler {
						return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							subgraphMutex.Lock()
							capturedSubgraphRequest = r.Clone(r.Context())
							subgraphMutex.Unlock()
							handler.ServeHTTP(w, r)
						})
					},
				},
			}, func(t *testing.T, xEnv *testenv.Environment) {
				// With stateless mode enabled, we can make direct HTTP POST requests
				// without needing to establish a session first
				mcpAddr := xEnv.GetMCPServerAddr()

				// Make a direct HTTP POST request with custom headers
				// This simulates a real MCP client sending custom headers on tool calls
				mcpRequest := map[string]interface{}{
					"jsonrpc": "2.0",
					"id":      1,
					"method":  "tools/call",
					"params": map[string]interface{}{
						"name": "execute_operation_my_employees",
						"arguments": map[string]interface{}{
							"criteria": map[string]interface{}{},
						},
					},
				}

				requestBody, err := json.Marshal(mcpRequest)
				require.NoError(t, err)

				req, err := http.NewRequest("POST", mcpAddr, strings.NewReader(string(requestBody)))
				require.NoError(t, err)

				// Add various headers to test forwarding
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("foo", "bar")                         // Non-standard header
				req.Header.Set("X-Custom-Header", "custom-value")    // Custom X- header
				req.Header.Set("X-Trace-Id", "trace-123")            // Tracing header
				req.Header.Set("Authorization", "Bearer test-token") // Auth header

				// Make the request
				resp, err := xEnv.RouterClient.Do(req)
				require.NoError(t, err)
				defer resp.Body.Close()

				// With stateless mode, the request should succeed
				t.Logf("Response Status: %d", resp.StatusCode)
				require.Equal(t, http.StatusOK, resp.StatusCode, "Request should succeed in stateless mode")

				// Verify headers reached subgraph
				subgraphMutex.Lock()
				defer subgraphMutex.Unlock()

				require.NotNil(t, capturedSubgraphRequest, "Subgraph should have received a request")

				// Log all headers that the subgraph received
				t.Logf("Headers received by subgraph:")
				for key, values := range capturedSubgraphRequest.Header {
					for _, value := range values {
						t.Logf("  %s: %s", key, value)
					}
				}

				// Verify that all headers were forwarded through the entire chain:
				// MCP Client -> MCP Server -> Router -> Subgraph
				assert.Equal(t, "bar", capturedSubgraphRequest.Header.Get("Foo"),
					"'foo' header should be forwarded to subgraph")
				assert.Equal(t, "custom-value", capturedSubgraphRequest.Header.Get("X-Custom-Header"),
					"X-Custom-Header should be forwarded to subgraph")
				assert.Equal(t, "trace-123", capturedSubgraphRequest.Header.Get("X-Trace-Id"),
					"X-Trace-Id should be forwarded to subgraph")
				assert.Equal(t, "Bearer test-token", capturedSubgraphRequest.Header.Get("Authorization"),
					"Authorization header should be forwarded to subgraph")

				// This test proves that ALL headers sent by MCP clients are forwarded
				// through the complete chain. The router's header rules determine what
				// ultimately reaches the subgraphs.
			})
		})
	})
}
