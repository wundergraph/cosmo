package integration

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap/zapcore"
)

func TestMCPManifest(t *testing.T) {
	t.Parallel()

	writeManifest := func(t *testing.T, dir, revision string, operations map[string]string) {
		t.Helper()
		data, err := json.Marshal(map[string]any{
			"version":     1,
			"revision":    revision,
			"generatedAt": "2026-01-01T00:00:00Z",
			"operations":  operations,
		})
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0o644))
	}

	// listToolNames takes require.TestingT so it also works inside EventuallyWithT.
	listToolNames := func(t require.TestingT, xEnv *testenv.Environment) []string {
		resp, err := xEnv.MCPClient.ListTools(xEnv.Context, mcp.ListToolsRequest{})
		require.NoError(t, err)
		names := make([]string, 0, len(resp.Tools))
		for _, tool := range resp.Tools {
			names = append(names, tool.Name)
		}
		slices.Sort(names)
		return names
	}

	mcpConfig := config.MCPConfiguration{
		Enabled:            true,
		OmitToolNamePrefix: true,
		Storage: config.MCPStorageConfig{
			ObjectPath:   "manifest.json",
			PollInterval: time.Second,
		},
	}

	initialOperations := map[string]string{
		"employeeIds":  `query { employees { id } }`,
		"find-mood_v1": `query MyEmployees { employees { currentMood } }`,
	}

	t.Run("lists the manifest keys as tool names", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		writeManifest(t, dir, "1", initialOperations)

		testenv.Run(t, &testenv.Config{
			MCP:               mcpConfig,
			MCPOperationsPath: dir,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Equal(t, []string{"employeeIds", "find-mood_v1", "get_operation_info"}, listToolNames(t, xEnv))
		})
	})

	t.Run("swaps the tools when the manifest has a new revision", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		writeManifest(t, dir, "1", initialOperations)

		testenv.Run(t, &testenv.Config{
			MCP:               mcpConfig,
			MCPOperationsPath: dir,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			writeManifest(t, dir, "2", map[string]string{
				"employeeIds":   `query { employees { id } }`,
				"employeeMoods": `query { employees { currentMood } }`,
			})

			require.EventuallyWithT(t, func(c *assert.CollectT) {
				assert.Equal(c, []string{"employeeIds", "employeeMoods", "get_operation_info"}, listToolNames(c, xEnv))
			}, 10*time.Second, 100*time.Millisecond)
		})
	})

	t.Run("keeps the previous tools when the manifest is invalid", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		writeManifest(t, dir, "1", initialOperations)

		testenv.Run(t, &testenv.Config{
			MCP:               mcpConfig,
			MCPOperationsPath: dir,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.WarnLevel,
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.NoError(t, os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"version": 1`), 0o644))

			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage("Failed to fetch manifest").Len() > 0
			}, 10*time.Second, 100*time.Millisecond)

			require.Equal(t, []string{"employeeIds", "find-mood_v1", "get_operation_info"}, listToolNames(t, xEnv))
		})
	})

	t.Run("keeps the manifest tools after a graph config reload", func(t *testing.T) {
		t.Parallel()

		dir := t.TempDir()
		writeManifest(t, dir, "1", initialOperations)

		pm := ConfigPollerMock{
			ready: make(chan struct{}),
		}

		testenv.Run(t, &testenv.Config{
			MCP:               mcpConfig,
			MCPOperationsPath: dir,
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return &pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// A new revision first, so the reload must use the current manifest and not the initial one.
			writeManifest(t, dir, "2", map[string]string{
				"employeeMoods": `query { employees { currentMood } }`,
			})
			require.EventuallyWithT(t, func(c *assert.CollectT) {
				assert.Equal(c, []string{"employeeMoods", "get_operation_info"}, listToolNames(c, xEnv))
			}, 10*time.Second, 100*time.Millisecond)

			<-pm.ready
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			require.Equal(t, []string{"employeeMoods", "get_operation_info"}, listToolNames(t, xEnv))
		})
	})
}
