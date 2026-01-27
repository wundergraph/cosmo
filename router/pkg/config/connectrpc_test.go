package config

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestConnectRPCConfiguration_ZeroValueSemantics tests that the zero value
// represents a safe, disabled state - a meaningful invariant to protect.
func TestConnectRPCConfiguration_ZeroValueSemantics(t *testing.T) {
	var cfg ConnectRPCConfiguration

	// These are the semantic expectations that matter:
	assert.False(t, cfg.Enabled, "ConnectRPC must be disabled by default for safety")
	assert.Empty(t, cfg.GraphQLEndpoint, "no implicit upstream when disabled")
}

// TestConnectRPCConfiguration_LoadFromYAML tests that config loading works correctly
// with actual YAML parsing and environment variable expansion.
func TestConnectRPCConfiguration_LoadFromYAML(t *testing.T) {
	tests := []struct {
		name           string
		yaml           string
		envVars        map[string]string
		wantEnabled    bool
		wantListenAddr string
		wantBaseURL    string
		wantGraphQL    string
		wantProviderID string
	}{
		{
			name: "minimal config with defaults",
			yaml: `connect_rpc:
  enabled: true
  storage:
    provider_id: "fs-services"
  graphql_endpoint: "http://localhost:3002/graphql"
`,
			wantEnabled:    true,
			wantListenAddr: "localhost:5026", // from envDefault tag
			wantBaseURL:    "",
			wantGraphQL:    "http://localhost:3002/graphql",
			wantProviderID: "fs-services",
		},
		{
			name: "full config with overrides",
			yaml: `connect_rpc:
  enabled: true
  server:
    listen_addr: "0.0.0.0:8080"
    base_url: "http://example.com"
  storage:
    provider_id: "fs-protos"
  graphql_endpoint: "http://localhost:4000/graphql"
`,
			wantEnabled:    true,
			wantListenAddr: "0.0.0.0:8080",
			wantBaseURL:    "http://example.com",
			wantGraphQL:    "http://localhost:4000/graphql",
			wantProviderID: "fs-protos",
		},
		{
			name: "config with environment variables",
			yaml: `connect_rpc:
  enabled: true
  storage:
    provider_id: "${PROVIDER_ID}"
  graphql_endpoint: "${GRAPHQL_ENDPOINT}"
`,
			envVars: map[string]string{
				"GRAPHQL_ENDPOINT": "http://env-graphql:3002/graphql",
				"PROVIDER_ID":      "env-provider",
			},
			wantEnabled:    true,
			wantListenAddr: "localhost:5026",
			wantBaseURL:    "",
			wantGraphQL:    "http://env-graphql:3002/graphql",
			wantProviderID: "env-provider",
		},
		{
			name: "disabled config",
			yaml: `connect_rpc:
  enabled: false
`,
			wantEnabled:    false,
			wantListenAddr: "localhost:5026",
			wantBaseURL:    "",
			wantGraphQL:    "",
			wantProviderID: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Set environment variables
			for k, v := range tt.envVars {
				t.Setenv(k, v)
			}

			// Create temporary config file
			tmpDir := t.TempDir()
			configPath := filepath.Join(tmpDir, "config.yaml")
			err := os.WriteFile(configPath, []byte(tt.yaml), 0644)
			require.NoError(t, err)

			// Load config
			result, err := LoadConfig([]string{configPath})
			require.NoError(t, err)
			require.NotNil(t, result)

			cfg := result.Config.ConnectRPC

			assert.Equal(t, tt.wantEnabled, cfg.Enabled)
			assert.Equal(t, tt.wantListenAddr, cfg.Server.ListenAddr)
			assert.Equal(t, tt.wantBaseURL, cfg.Server.BaseURL)
			assert.Equal(t, tt.wantGraphQL, cfg.GraphQLEndpoint)
			assert.Equal(t, tt.wantProviderID, cfg.Storage.ProviderID)
		})
	}
}

// TestConnectRPCConfiguration_EnvDefaults tests that environment variable
// defaults are applied correctly when no config file values are provided.
func TestConnectRPCConfiguration_EnvDefaults(t *testing.T) {
	yaml := `
connect_rpc:
  enabled: true
  storage:
    provider_id: "fs-services"
  graphql_endpoint: "http://localhost:3002/graphql"
`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")
	err := os.WriteFile(configPath, []byte(yaml), 0644)
	require.NoError(t, err)

	result, err := LoadConfig([]string{configPath})
	require.NoError(t, err)

	// Verify envDefault values are applied
	assert.Equal(t, "localhost:5026", result.Config.ConnectRPC.Server.ListenAddr,
		"should use envDefault from struct tag")
}

// TestConnectRPCConfiguration_Integration tests that ConnectRPC config
// integrates properly with the main Config structure through actual loading.
func TestConnectRPCConfiguration_Integration(t *testing.T) {
	yaml := `
version: "1"
listen_addr: "localhost:3002"
connect_rpc:
  enabled: true
  server:
    listen_addr: "0.0.0.0:5026"
  storage:
    provider_id: "fs-protos"
  graphql_endpoint: "http://localhost:3002/graphql"
`
	tmpDir := t.TempDir()
	configPath := filepath.Join(tmpDir, "config.yaml")
	err := os.WriteFile(configPath, []byte(yaml), 0644)
	require.NoError(t, err)

	result, err := LoadConfig([]string{configPath})
	require.NoError(t, err)

	// Verify ConnectRPC is properly nested in main config
	assert.True(t, result.Config.ConnectRPC.Enabled)
	assert.Equal(t, "0.0.0.0:5026", result.Config.ConnectRPC.Server.ListenAddr)
	assert.Equal(t, "fs-protos", result.Config.ConnectRPC.Storage.ProviderID)

	// Verify main config is also loaded
	assert.Equal(t, "localhost:3002", result.Config.ListenAddr)
}

// TestConnectRPCConfiguration_MultipleConfigMerge tests that ConnectRPC config
// can be properly merged across multiple config files.
func TestConnectRPCConfiguration_MultipleConfigMerge(t *testing.T) {
	baseYaml := `
connect_rpc:
  enabled: true
  storage:
    provider_id: "base-provider"
  graphql_endpoint: "http://localhost:3002/graphql"
`
	overrideYaml := `
connect_rpc:
  server:
    listen_addr: "0.0.0.0:9090"
  storage:
    provider_id: "override-provider"
`

	tmpDir := t.TempDir()
	basePath := filepath.Join(tmpDir, "base.yaml")
	overridePath := filepath.Join(tmpDir, "override.yaml")

	err := os.WriteFile(basePath, []byte(baseYaml), 0644)
	require.NoError(t, err)
	err = os.WriteFile(overridePath, []byte(overrideYaml), 0644)
	require.NoError(t, err)

	result, err := LoadConfig([]string{basePath, overridePath})
	require.NoError(t, err)

	// Verify merged config
	assert.True(t, result.Config.ConnectRPC.Enabled, "should keep base value")
	assert.Equal(t, "http://localhost:3002/graphql", result.Config.ConnectRPC.GraphQLEndpoint, "should keep base value")
	assert.Equal(t, "0.0.0.0:9090", result.Config.ConnectRPC.Server.ListenAddr, "should use override value")
	assert.Equal(t, "override-provider", result.Config.ConnectRPC.Storage.ProviderID, "should use override value")
}
