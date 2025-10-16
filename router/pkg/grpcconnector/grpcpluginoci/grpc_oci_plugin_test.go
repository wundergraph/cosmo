package grpcpluginoci

import (
	"github.com/wundergraph/cosmo/router/pkg/grpcconnector/grpccommon"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNewGRPCOCIPlugin(t *testing.T) {
	tests := []struct {
		name        string
		config      GRPCPluginConfig
		wantErr     bool
		errContains string
	}{
		{
			name: "successful creation with valid config",
			config: GRPCPluginConfig{
				Logger:        zap.NewNop(),
				ImageRef:      "cosmo-registry.wundergraph-test/org/image",
				RegistryToken: "lalala",
			},
			wantErr: false,
		},
		{
			name: "fails with nil logger",
			config: GRPCPluginConfig{
				Logger:        nil,
				ImageRef:      "cosmo-registry.wundergraph-test/org/image",
				RegistryToken: "lalala",
			},
			wantErr:     true,
			errContains: "logger is required",
		},
		{
			name: "fails with no registry token",
			config: GRPCPluginConfig{
				Logger:   zap.NewNop(),
				ImageRef: "cosmo-registry.wundergraph-test/org/image",
			},
			wantErr:     true,
			errContains: "registry token is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plugin, err := NewGRPCOCIPlugin(tt.config)

			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errContains)
				assert.Nil(t, plugin)
				return
			}

			require.NoError(t, err)
			require.NotNil(t, plugin)

			// Verify the plugin was initialized with correct values
			assert.Equal(t, tt.config.Logger, plugin.logger)
			assert.NotNil(t, plugin.done)
			assert.False(t, plugin.disposed.Load())
		})
	}
}

func TestNewGRPCOCIPluginWithStartupConfig(t *testing.T) {
	t.Run("successful creation with startup config", func(t *testing.T) {
		telemetry := &grpccommon.GRPCTelemetry{
			Tracing: &grpccommon.GRPCTracing{
				Sampler: 1.0,
			},
		}
		plugin := GRPCPluginConfig{
			Logger:        zap.NewNop(),
			ImageRef:      "cosmo-registry.wundergraph-test/org/image",
			RegistryToken: "lalala",
			StartupConfig: grpccommon.GRPCStartupParams{
				Telemetry: telemetry,
			},
		}

		grpcPlugin, err := NewGRPCOCIPlugin(plugin)
		assert.NoError(t, err)

		assert.NotNil(t, grpcPlugin.startupConfig.Telemetry)
		assert.Equal(t, grpcPlugin.startupConfig.Telemetry, telemetry)
	})
}
