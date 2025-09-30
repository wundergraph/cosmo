package grpcpluginoci

import (
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
