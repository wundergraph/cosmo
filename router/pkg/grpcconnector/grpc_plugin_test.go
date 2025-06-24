package grpcconnector

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestNewGRPCPlugin(t *testing.T) {
	tests := []struct {
		name        string
		config      GRPCPluginConfig
		wantErr     bool
		errContains string
	}{
		{
			name: "successful creation with valid config",
			config: GRPCPluginConfig{
				Logger:     zap.NewNop(),
				PluginPath: "/path/to/plugin",
				PluginName: "test-plugin",
			},
			wantErr: false,
		},
		{
			name: "fails with nil logger",
			config: GRPCPluginConfig{
				Logger:     nil,
				PluginPath: "/path/to/plugin",
				PluginName: "test-plugin",
			},
			wantErr:     true,
			errContains: "logger is required",
		},
		{
			name: "fails with empty plugin name",
			config: GRPCPluginConfig{
				Logger:     zap.NewNop(),
				PluginPath: "/path/to/plugin",
				PluginName: "",
			},
			wantErr:     true,
			errContains: "plugin name is required",
		},
		{
			name: "fails with empty plugin path",
			config: GRPCPluginConfig{
				Logger:     zap.NewNop(),
				PluginPath: "",
				PluginName: "test-plugin",
			},
			wantErr:     true,
			errContains: "plugin path is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plugin, err := NewGRPCPlugin(tt.config)

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
			assert.Equal(t, tt.config.PluginPath, plugin.pluginPath)
			assert.Equal(t, tt.config.PluginName, plugin.pluginName)
			assert.NotNil(t, plugin.done)
			assert.False(t, plugin.disposed.Load())
		})
	}
}
