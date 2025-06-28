package integration

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/goleak"
)

func TestMCPOperationHotReload(t *testing.T) {
	t.Parallel()

	t.Run("List Updated User Operations On Addition and Removal", func(t *testing.T) {

		operationsDir := t.TempDir()
		storageProviderId := "mcp_hot_reload_test_id"

		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				Storage: config.MCPStorageConfig{
					ProviderID: storageProviderId,
				},
				HotReloadConfig: config.MCPOperationsHotReloadConfig{
					Enabled:  true,
					Interval: 5 * time.Second,
				},
			},
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					FileSystem: []config.FileSystemStorageProvider{
						{
							ID:   storageProviderId,
							Path: operationsDir,
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			toolsRequest := mcp.ListToolsRequest{}
			resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
			require.NoError(t, err)

			initialToolsCount := len(resp.Tools)

			filePath := operationsDir + "/main.graphql"

			// write mcp operation content
			err = os.WriteFile(filePath, []byte("query getEmployeeNotes($id: Int!) {\nemployee(id: $id) {\nid\nnotes\n}\n}"), 0644)
			assert.NoError(t, err)

			require.EventuallyWithT(t, func(t *assert.CollectT) {

				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)
				assert.Len(t, resp.Tools, initialToolsCount+1)

				// verity getEmployeeNotes operation is present
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

			err = os.Remove(filePath)
			assert.NoError(t, err)

			assert.EventuallyWithT(t, func(t *assert.CollectT) {

				resp, err = xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)
				assert.Len(t, resp.Tools, initialToolsCount)

				// verity getEmployeeNotes operation tool is properly removed
				require.NotContains(t, resp.Tools, mcp.Tool{
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
		operationsDir := t.TempDir()
		storageProviderId := "mcp_hot_reload_test_id"

		testenv.Run(t, &testenv.Config{
			MCP: config.MCPConfiguration{
				Enabled: true,
				Storage: config.MCPStorageConfig{
					ProviderID: storageProviderId,
				},
				HotReloadConfig: config.MCPOperationsHotReloadConfig{
					Enabled:  true,
					Interval: 5 * time.Second,
				},
			},
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					FileSystem: []config.FileSystemStorageProvider{
						{
							ID:   storageProviderId,
							Path: operationsDir,
						},
					},
				}),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {

			filePath := operationsDir + "/main.graphql"

			// write mcp operation content
			err := os.WriteFile(filePath, []byte("query getEmployeeNotes($id: Int!) {\nemployee(id: $id) {\nid\nnotes\n}\n}"), 0644)
			assert.NoError(t, err)

			require.EventuallyWithT(t, func(t *assert.CollectT) {

				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)

				// verity getEmployeeNotes operation is present
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
			err = os.WriteFile(filePath, []byte("\nquery getEmployeeNotesUpdatedTitle($id: Int!) {\nemployee(id: $id) {\nid\nnotes\n}\n}"), 0644)
			assert.NoError(t, err)

			require.EventuallyWithT(t, func(t *assert.CollectT) {

				toolsRequest := mcp.ListToolsRequest{}
				resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
				assert.NoError(t, err)

				// verity getEmployeeNotesUpdatedTitle operation is present
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

func TestShutDownMCPGoRoutineLeaks(t *testing.T) {

	defer goleak.VerifyNone(t,
		goleak.IgnoreTopFunction("github.com/hashicorp/consul/sdk/freeport.checkFreedPorts"), // Freeport, spawned by init
		goleak.IgnoreAnyFunction("net/http.(*conn).serve"),                                   // HTTPTest server I can't close if I want to keep the problematic goroutine open for the test
	)

	operationsDir := t.TempDir()
	storageProviderId := "mcp_hot_reload_test_id"

	xEnv, err := testenv.CreateTestEnv(t, &testenv.Config{
		MCP: config.MCPConfiguration{
			Enabled: true,
			Storage: config.MCPStorageConfig{
				ProviderID: storageProviderId,
			},
			HotReloadConfig: config.MCPOperationsHotReloadConfig{
				Enabled:  true,
				Interval: 5 * time.Second,
			},
		},
		RouterOptions: []core.Option{
			core.WithStorageProviders(config.StorageProviders{
				FileSystem: []config.FileSystemStorageProvider{
					{
						ID:   storageProviderId,
						Path: operationsDir,
					},
				},
			}),
		},
	})

	require.NoError(t, err)

	filePath := operationsDir + "/main.graphql"
	// write mcp operation content
	err = os.WriteFile(filePath, []byte("query getEmployeeNotes($id: Int!) {\nemployee(id: $id) {\nid\nnotes\n}\n}"), 0644)
	assert.NoError(t, err)

	// Verify GoRoutines are properly setup for Hot Reloading
	require.EventuallyWithT(t, func(t *assert.CollectT) {

		toolsRequest := mcp.ListToolsRequest{}
		resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
		assert.NoError(t, err)

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

	xEnv.Shutdown()

	toolsRequest := mcp.ListToolsRequest{}
	resp, err := xEnv.MCPClient.ListTools(xEnv.Context, toolsRequest)
	if assert.Error(t, err) {
		require.ErrorIs(t, err, testenv.ErrEnvironmentClosed)
	}
	require.Nil(t, resp)

}
