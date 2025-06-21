package integration

import (
	"encoding/json"
	"os"
	"path"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

func TestMCPOperationHotReload(t *testing.T) {
	// create a temp graphql file into mcp_operations
	mcpOperationsDirectory := "./testdata/mcp_operations"
	fileName := "getEmployeeNotes.graphql"
	filePath := path.Join(mcpOperationsDirectory, fileName)

	t.Parallel()

	t.Run("List Updated User Operations On Addition and Removal", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				HotReloadConfig: config.MCPOperationsHotReloadConfig{
					Enabled:  true,
					Interval: 5 * time.Second,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			os.Remove(filePath)

			toolsRequest := mcp.ListToolsRequest{}
			resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
			require.NoError(t, err)
			require.NotNil(t, resp)

			// initial tools count
			initialToolsCount := len(resp.Tools)

			// create new mcp operation file
			file, err := os.Create(filePath)
			assert.NoError(t, err)
			defer func() {
				file.Close()
				os.Remove(filePath)
			}()

			// write mcp operation content
			_, err = file.WriteString(`
			query getEmployeeNotes($id: Int!) {
				employee(id: $id) {
					id
					notes
				}
			}
			`)
			assert.NoError(t, err)

			require.EventuallyWithT(t, func(t *assert.CollectT) {
				// List updated Tools
				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)

				// verify updated tools count
				assert.Len(t, resp.Tools, initialToolsCount+1)

				// verity getEmployeeNotes operation
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_operation_get_employee_notes",
					Description: "Executes the GraphQL operation 'getEmployeeNotes' of type query.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{"id": map[string]interface{}{"type": "integer"}},
						Required:   []string{"id"},
					},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:          "Execute operation getEmployeeNotes",
						ReadOnlyHint:   mcp.ToBoolPtr(true),
						IdempotentHint: mcp.ToBoolPtr(true),
						OpenWorldHint:  mcp.ToBoolPtr(true),
					},
				})
			}, 15*time.Second, 250*time.Millisecond)

		})
	})

	t.Run("List Updated User Operations On Content Update", func(t *testing.T) {
		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				HotReloadConfig: config.MCPOperationsHotReloadConfig{
					Enabled:  true,
					Interval: 5 * time.Second,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			os.Remove(filePath)

			// create new mcp operation file
			file, err := os.Create(filePath)
			assert.NoError(t, err)
			defer func() {
				file.Close()
				os.Remove(filePath)
			}()

			// write mcp operation content
			_, err = file.WriteString(`
			query getEmployeeNotes($id: Int!) {
				employee(id: $id) {
					id
					notes
				}
			}
			`)
			assert.NoError(t, err)

			require.EventuallyWithT(t, func(t *assert.CollectT) {
				// List updated Tools
				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)

				// verity getEmployeeNotes operation
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_operation_get_employee_notes",
					Description: "Executes the GraphQL operation 'getEmployeeNotes' of type query.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{"id": map[string]interface{}{"type": "integer"}},
						Required:   []string{"id"},
					},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:          "Execute operation getEmployeeNotes",
						ReadOnlyHint:   mcp.ToBoolPtr(true),
						IdempotentHint: mcp.ToBoolPtr(true),
						OpenWorldHint:  mcp.ToBoolPtr(true),
					},
				})
			}, 15*time.Second, 250*time.Millisecond)

			// update mcp operation content
			err = os.WriteFile(filePath, []byte(`
			query getEmployeeNotesUpdatedTitle($id: Int!) {
				employee(id: $id) {
					id
					notes
				}
			}
			`), 0644)
			assert.NoError(t, err)

			require.EventuallyWithT(t, func(t *assert.CollectT) {
				// fetch updated mcp tools list
				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)

				// verity getEmployeeNotesUpdatedTitle operation
				require.Contains(t, resp.Tools, mcp.Tool{
					Name:        "execute_operation_get_employee_notes_updated_title",
					Description: "Executes the GraphQL operation 'getEmployeeNotesUpdatedTitle' of type query.",
					InputSchema: mcp.ToolInputSchema{
						Type:       "object",
						Properties: map[string]interface{}{"id": map[string]interface{}{"type": "integer"}},
						Required:   []string{"id"},
					},
					RawInputSchema: json.RawMessage(nil),
					Annotations: mcp.ToolAnnotation{
						Title:          "Execute operation getEmployeeNotesUpdatedTitle",
						ReadOnlyHint:   mcp.ToBoolPtr(true),
						IdempotentHint: mcp.ToBoolPtr(true),
						OpenWorldHint:  mcp.ToBoolPtr(true),
					},
				})
			}, 15*time.Second, 250*time.Millisecond)
		})
	})

}
