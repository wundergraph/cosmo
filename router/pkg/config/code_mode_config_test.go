package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMCPCodeModeConfigurationDefaults(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"
`)

	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	assert.Equal(t, MCPCodeModeConfiguration{
		Enabled:                 false,
		Server:                  MCPCodeModeServerConfig{ListenAddr: "localhost:5027"},
		RequireMutationApproval: true,
		ExecuteTimeout:          120 * time.Second,
		MaxResultBytes:          32768,
		Sandbox: MCPCodeModeSandboxConfig{
			Timeout:            5 * time.Second,
			MaxMemoryMB:        16,
			MaxInputSizeBytes:  65536,
			MaxOutputSizeBytes: 1048576,
		},
		QueryGeneration: MCPCodeModeQueryGenConfig{
			Enabled:  false,
			Endpoint: "",
			Timeout:  10 * time.Second,
			Auth: MCPCodeModeQueryGenAuthConfig{
				Type:          "static",
				StaticToken:   "",
				TokenEndpoint: "",
				ClientID:      "",
				ClientSecret:  "",
			},
		},
		NamedOps: MCPCodeModeNamedOpsConfig{
			Enabled:        false,
			SessionTTL:     30 * time.Minute,
			MaxSessions:    1000,
			MaxBundleBytes: 262144,
			Storage: MCPCodeModeNamedOpsStorageConfig{
				ProviderID: "",
				KeyPrefix:  "cosmo_code_mode",
			},
		},
	}, cfg.Config.MCP.CodeMode)
}

func TestMCPCodeModeConfigurationFullYAMLOverride(t *testing.T) {
	f := createTempFileFromFixture(t, `
version: "1"

mcp:
  session:
    stateless: false
  code_mode:
    enabled: true
    server:
      listen_addr: "0.0.0.0:6027"
    require_mutation_approval: false
    execute_timeout: "45s"
    max_result_bytes: 64000
    sandbox:
      timeout: "7s"
      max_memory_mb: 32
      max_input_size_bytes: 131072
      max_output_size_bytes: 2097152
    query_generation:
      enabled: true
      endpoint: "https://yoko.example.com"
      timeout: "15s"
      auth:
        type: "jwt"
        static_token: "unused-static"
        token_endpoint: "https://auth.example.com/token"
        client_id: "router-client"
        client_secret: "router-secret"
    named_ops:
      enabled: true
      session_ttl: "45m"
      max_sessions: 2000
      max_bundle_bytes: 524288
      storage:
        provider_id: "my_redis"
        key_prefix: "custom_code_mode"
`)

	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	assert.Equal(t, MCPCodeModeConfiguration{
		Enabled:                 true,
		Server:                  MCPCodeModeServerConfig{ListenAddr: "0.0.0.0:6027"},
		RequireMutationApproval: false,
		ExecuteTimeout:          45 * time.Second,
		MaxResultBytes:          64000,
		Sandbox: MCPCodeModeSandboxConfig{
			Timeout:            7 * time.Second,
			MaxMemoryMB:        32,
			MaxInputSizeBytes:  131072,
			MaxOutputSizeBytes: 2097152,
		},
		QueryGeneration: MCPCodeModeQueryGenConfig{
			Enabled:  true,
			Endpoint: "https://yoko.example.com",
			Timeout:  15 * time.Second,
			Auth: MCPCodeModeQueryGenAuthConfig{
				Type:          "jwt",
				StaticToken:   "unused-static",
				TokenEndpoint: "https://auth.example.com/token",
				ClientID:      "router-client",
				ClientSecret:  "router-secret",
			},
		},
		NamedOps: MCPCodeModeNamedOpsConfig{
			Enabled:        true,
			SessionTTL:     45 * time.Minute,
			MaxSessions:    2000,
			MaxBundleBytes: 524288,
			Storage: MCPCodeModeNamedOpsStorageConfig{
				ProviderID: "my_redis",
				KeyPrefix:  "custom_code_mode",
			},
		},
	}, cfg.Config.MCP.CodeMode)
}

func TestMCPCodeModeConfigurationEnvOverride(t *testing.T) {
	t.Setenv("MCP_CODE_MODE_ENABLED", "true")
	t.Setenv("MCP_CODE_MODE_LISTEN_ADDR", "127.0.0.1:6027")
	t.Setenv("MCP_CODE_MODE_REQUIRE_MUTATION_APPROVAL", "false")
	t.Setenv("MCP_CODE_MODE_EXECUTE_TIMEOUT", "30s")
	t.Setenv("MCP_CODE_MODE_MAX_RESULT_BYTES", "49152")
	t.Setenv("MCP_CODE_MODE_SANDBOX_TIMEOUT", "8s")
	t.Setenv("MCP_CODE_MODE_SANDBOX_MAX_MEMORY_MB", "64")
	t.Setenv("MCP_CODE_MODE_SANDBOX_MAX_INPUT_SIZE_BYTES", "262144")
	t.Setenv("MCP_CODE_MODE_SANDBOX_MAX_OUTPUT_SIZE_BYTES", "3145728")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_ENABLED", "true")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_ENDPOINT", "https://env-yoko.example.com")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_TIMEOUT", "20s")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_AUTH_TYPE", "jwt")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_AUTH_STATIC_TOKEN", "env-static-token")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_AUTH_TOKEN_ENDPOINT", "https://env-auth.example.com/token")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_AUTH_CLIENT_ID", "env-client")
	t.Setenv("MCP_CODE_MODE_QUERY_GENERATION_AUTH_CLIENT_SECRET", "env-secret")
	t.Setenv("MCP_CODE_MODE_NAMED_OPS_ENABLED", "true")
	t.Setenv("MCP_CODE_MODE_NAMED_OPS_SESSION_TTL", "1h")
	t.Setenv("MCP_CODE_MODE_NAMED_OPS_MAX_SESSIONS", "3000")
	t.Setenv("MCP_CODE_MODE_NAMED_OPS_MAX_BUNDLE_BYTES", "1048576")
	t.Setenv("MCP_CODE_MODE_NAMED_OPS_STORAGE_PROVIDER_ID", "env_redis")
	t.Setenv("MCP_CODE_MODE_NAMED_OPS_STORAGE_KEY_PREFIX", "env_code_mode")

	f := createTempFileFromFixture(t, `
version: "1"

mcp:
  session:
    stateless: false
`)

	cfg, err := LoadConfig([]string{f})
	require.NoError(t, err)

	assert.Equal(t, MCPCodeModeConfiguration{
		Enabled:                 true,
		Server:                  MCPCodeModeServerConfig{ListenAddr: "127.0.0.1:6027"},
		RequireMutationApproval: false,
		ExecuteTimeout:          30 * time.Second,
		MaxResultBytes:          49152,
		Sandbox: MCPCodeModeSandboxConfig{
			Timeout:            8 * time.Second,
			MaxMemoryMB:        64,
			MaxInputSizeBytes:  262144,
			MaxOutputSizeBytes: 3145728,
		},
		QueryGeneration: MCPCodeModeQueryGenConfig{
			Enabled:  true,
			Endpoint: "https://env-yoko.example.com",
			Timeout:  20 * time.Second,
			Auth: MCPCodeModeQueryGenAuthConfig{
				Type:          "jwt",
				StaticToken:   "env-static-token",
				TokenEndpoint: "https://env-auth.example.com/token",
				ClientID:      "env-client",
				ClientSecret:  "env-secret",
			},
		},
		NamedOps: MCPCodeModeNamedOpsConfig{
			Enabled:        true,
			SessionTTL:     time.Hour,
			MaxSessions:    3000,
			MaxBundleBytes: 1048576,
			Storage: MCPCodeModeNamedOpsStorageConfig{
				ProviderID: "env_redis",
				KeyPrefix:  "env_code_mode",
			},
		},
	}, cfg.Config.MCP.CodeMode)
}

func TestValidateMCPCodeMode(t *testing.T) {
	tests := []struct {
		name             string
		cfg              MCPCodeModeConfiguration
		sessionStateless bool
		wantErr          string
	}{
		{
			name: "code mode disabled skips validation",
			cfg: MCPCodeModeConfiguration{
				Enabled: false,
				NamedOps: MCPCodeModeNamedOpsConfig{
					Enabled: true,
				},
			},
		},
		{
			name: "named ops disabled skips validation",
			cfg: MCPCodeModeConfiguration{
				Enabled: true,
				NamedOps: MCPCodeModeNamedOpsConfig{
					Enabled: false,
				},
			},
		},
		{
			name: "memory backend (no provider_id) is valid",
			cfg: MCPCodeModeConfiguration{
				Enabled: true,
				NamedOps: MCPCodeModeNamedOpsConfig{
					Enabled: true,
					Storage: MCPCodeModeNamedOpsStorageConfig{KeyPrefix: "cosmo_code_mode"},
				},
			},
		},
		{
			name: "redis-backed (provider_id set) is valid",
			cfg: MCPCodeModeConfiguration{
				Enabled: true,
				NamedOps: MCPCodeModeNamedOpsConfig{
					Enabled: true,
					Storage: MCPCodeModeNamedOpsStorageConfig{
						ProviderID: "my_redis",
						KeyPrefix:  "cosmo_code_mode",
					},
				},
			},
		},
		{
			name: "stateless named ops does not fail boot validation",
			cfg: MCPCodeModeConfiguration{
				Enabled: true,
				NamedOps: MCPCodeModeNamedOpsConfig{
					Enabled: true,
				},
			},
			sessionStateless: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateMCPCodeMode(&tt.cfg, tt.sessionStateless)
			if tt.wantErr == "" {
				require.NoError(t, err)
				return
			}
			require.EqualError(t, err, tt.wantErr)
		})
	}
}
