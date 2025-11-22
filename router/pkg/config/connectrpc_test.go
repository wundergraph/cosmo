package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestConnectRPCConfiguration_Defaults(t *testing.T) {
	cfg := ConnectRPCConfiguration{}
	
	// Test default values
	assert.False(t, cfg.Enabled, "ConnectRPC should be disabled by default")
	assert.Empty(t, cfg.GraphQLEndpoint, "GraphQL endpoint should be empty by default")
	assert.Empty(t, cfg.Storage.ProviderID, "Storage provider ID should be empty by default")
	assert.Equal(t, "", cfg.Server.ListenAddr, "Listen address should use default")
	assert.Empty(t, cfg.Server.BaseURL, "Base URL should be empty by default")
	assert.Empty(t, cfg.OperationsDir, "Operations directory should be empty by default")
}

func TestConnectRPCConfiguration_WithValues(t *testing.T) {
	cfg := ConnectRPCConfiguration{
		Enabled: true,
		Server: ConnectRPCServer{
			ListenAddr: "localhost:5026",
			BaseURL:    "http://localhost:5026",
		},
		Storage: ConnectRPCStorageConfig{
			ProviderID: "fs-protos",
		},
		GraphQLEndpoint: "http://localhost:3002/graphql",
		OperationsDir:   "./operations",
	}
	
	assert.True(t, cfg.Enabled)
	assert.Equal(t, "localhost:5026", cfg.Server.ListenAddr)
	assert.Equal(t, "http://localhost:5026", cfg.Server.BaseURL)
	assert.Equal(t, "fs-protos", cfg.Storage.ProviderID)
	assert.Equal(t, "http://localhost:3002/graphql", cfg.GraphQLEndpoint)
	assert.Equal(t, "./operations", cfg.OperationsDir)
}

func TestConnectRPCConfiguration_StorageProvider(t *testing.T) {
	tests := []struct {
		name       string
		providerID string
		wantErr    bool
	}{
		{
			name:       "filesystem provider",
			providerID: "fs-protos",
			wantErr:    false,
		},
		{
			name:       "s3 provider",
			providerID: "s3-protos",
			wantErr:    false,
		},
		{
			name:       "cdn provider",
			providerID: "cdn-protos",
			wantErr:    false,
		},
		{
			name:       "redis provider",
			providerID: "redis-protos",
			wantErr:    false,
		},
		{
			name:       "empty provider",
			providerID: "",
			wantErr:    false, // Empty is valid, will use default
		},
	}
	
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := ConnectRPCConfiguration{
				Storage: ConnectRPCStorageConfig{
					ProviderID: tt.providerID,
				},
			}
			
			assert.Equal(t, tt.providerID, cfg.Storage.ProviderID)
		})
	}
}

func TestConnectRPCConfiguration_Integration(t *testing.T) {
	// Test that ConnectRPC config integrates properly with main Config
	mainCfg := Config{
		ConnectRPC: ConnectRPCConfiguration{
			Enabled: true,
			Server: ConnectRPCServer{
				ListenAddr: "0.0.0.0:5026",
			},
			Storage: ConnectRPCStorageConfig{
				ProviderID: "fs-protos",
			},
			GraphQLEndpoint: "http://localhost:3002/graphql",
			OperationsDir:   "./operations",
		},
	}
	
	require.NotNil(t, mainCfg.ConnectRPC)
	assert.True(t, mainCfg.ConnectRPC.Enabled)
	assert.Equal(t, "0.0.0.0:5026", mainCfg.ConnectRPC.Server.ListenAddr)
	assert.Equal(t, "fs-protos", mainCfg.ConnectRPC.Storage.ProviderID)
	assert.Equal(t, "./operations", mainCfg.ConnectRPC.OperationsDir)
}

func TestConnectRPCServer_Defaults(t *testing.T) {
	server := ConnectRPCServer{}
	
	assert.Empty(t, server.ListenAddr, "Listen address should be empty by default")
	assert.Empty(t, server.BaseURL, "Base URL should be empty by default")
}

func TestConnectRPCStorageConfig_Defaults(t *testing.T) {
	storage := ConnectRPCStorageConfig{}
	
	assert.Empty(t, storage.ProviderID, "Provider ID should be empty by default")
}