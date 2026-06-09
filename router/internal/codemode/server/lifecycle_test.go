package server

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"github.com/wundergraph/cosmo/router/internal/codemode/yoko"
	"github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/astparser"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/asttransform"
	"go.uber.org/zap"
)

func TestBuildFromConfigDisabledIsNoOp(t *testing.T) {
	srv, err := BuildFromConfig(BuildOptions{
		Config:           config.MCPCodeModeConfiguration{Enabled: false},
		SessionStateless: false,
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Start(context.Background()))
	assert.Equal(t, "", srv.addr())
	require.NoError(t, srv.Reload(&ast.Document{}, "schema { query: Query }"))
	require.NoError(t, srv.Stop(context.Background()))
}

func TestBuildFromConfigMemoryBackendReloadsSchemaAndSDL(t *testing.T) {
	cfg := fullLifecycleConfig()
	srv, err := BuildFromConfig(BuildOptions{
		Config:           cfg,
		SessionStateless: false,
		RouterGraphQLURL: "http://router.local/graphql",
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	backend, ok := srv.storage.(*storage.MemoryBackend)
	require.True(t, ok)

	schema := lifecycleTestSchema(t)
	require.NoError(t, srv.Reload(schema, "type Query { orders: [Order!]! }"))

	assert.Equal(t, schema, backend.Schema())
	client, ok := srv.yokoClient.(*yoko.Client)
	require.True(t, ok)
	assert.Equal(t, "type Query { orders: [Order!]! }", client.Schema())
}

func TestBuildFromConfigRedisFactoryError(t *testing.T) {
	cfg := fullLifecycleConfig()
	cfg.NamedOps.Storage.ProviderID = "my_redis"

	srv, err := BuildFromConfig(BuildOptions{
		Config:           cfg,
		SessionStateless: false,
		RouterGraphQLURL: "http://router.local/graphql",
		Logger:           zap.NewNop(),
		RedisProvider: &config.RedisStorageProvider{
			ID:   "my_redis",
			URLs: []string{"redis://127.0.0.1:6379"},
		},
		RedisFactory: func(*rediscloser.RedisCloserOptions) (rediscloser.RDCloser, error) {
			return nil, errors.New("redis unavailable")
		},
	})

	require.Nil(t, srv)
	require.ErrorContains(t, err, "create code mode redis storage client: redis unavailable")
}

func TestBuildFromConfigRedisBackendWithMiniredis(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		if isBindPermissionError(err) {
			t.Skipf("local miniredis bind is not permitted in this environment: %v", err)
		}
		require.NoError(t, err)
	}
	t.Cleanup(mr.Close)
	var gotOpts rediscloser.RedisCloserOptions
	var client *redis.Client
	t.Cleanup(func() {
		if client != nil {
			require.NoError(t, client.Close())
		}
	})

	cfg := fullLifecycleConfig()
	cfg.NamedOps.Storage.ProviderID = "my_redis"
	cfg.NamedOps.Storage.KeyPrefix = "test_code_mode"

	srv, err := BuildFromConfig(BuildOptions{
		Config:           cfg,
		SessionStateless: false,
		RouterGraphQLURL: "http://router.local/graphql",
		Logger:           zap.NewNop(),
		RedisProvider: &config.RedisStorageProvider{
			ID:             "my_redis",
			URLs:           []string{"redis://" + mr.Addr()},
			ClusterEnabled: true,
		},
		RedisFactory: func(opts *rediscloser.RedisCloserOptions) (rediscloser.RDCloser, error) {
			gotOpts = *opts
			client = redis.NewClient(&redis.Options{Addr: mr.Addr()})
			return client, nil
		},
	})
	require.NoError(t, err)

	_, ok := srv.storage.(*storage.RedisBackend)
	require.True(t, ok)
	assert.NotNil(t, gotOpts.Logger)
	assert.Equal(t, []string{"redis://" + mr.Addr()}, gotOpts.URLs)
	assert.Equal(t, true, gotOpts.ClusterEnabled)
}

func TestBuildFromConfigReloadEvictsMemorySessions(t *testing.T) {
	srv, err := BuildFromConfig(BuildOptions{
		Config:           fullLifecycleConfig(),
		SessionStateless: false,
		RouterGraphQLURL: "http://router.local/graphql",
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	_, err = srv.storage.Append(context.Background(), "session-1", []storage.SessionOp{{
		Name:        "getOrders",
		Body:        "query GetOrders { orders { id } }",
		Kind:        storage.OperationKindQuery,
		Description: "Fetch orders.",
	}})
	require.NoError(t, err)

	_, ok, err := srv.storage.GetOp(context.Background(), "session-1", "getOrders")
	require.NoError(t, err)
	assert.Equal(t, true, ok)

	require.NoError(t, srv.Reload(lifecycleTestSchema(t), "type Query { customer: Customer }"))

	got, ok, err := srv.storage.GetOp(context.Background(), "session-1", "getOrders")
	require.NoError(t, err)
	assert.Equal(t, false, ok)
	assert.Equal(t, storage.SessionOp{}, got)
}

func TestBuildFromConfigDisabledReloadIsNoOp(t *testing.T) {
	srv, err := BuildFromConfig(BuildOptions{
		Config:           config.MCPCodeModeConfiguration{Enabled: false},
		SessionStateless: false,
		Logger:           zap.NewNop(),
	})
	require.NoError(t, err)

	require.NoError(t, srv.Reload(lifecycleTestSchema(t), "type Query { orders: [Order!]! }"))
	assert.Nil(t, srv.storage)
	assert.Nil(t, srv.yokoClient)
}

func fullLifecycleConfig() config.MCPCodeModeConfiguration {
	return config.MCPCodeModeConfiguration{
		Enabled:                 true,
		Server:                  config.MCPCodeModeServerConfig{ListenAddr: "127.0.0.1:0"},
		RequireMutationApproval: true,
		ExecuteTimeout:          120 * time.Second,
		MaxResultBytes:          32 << 10,
		Sandbox: config.MCPCodeModeSandboxConfig{
			Timeout:            5 * time.Second,
			MaxMemoryMB:        16,
			MaxInputSizeBytes:  64 << 10,
			MaxOutputSizeBytes: 1 << 20,
		},
		QueryGeneration: config.MCPCodeModeQueryGenConfig{
			Enabled:  true,
			Endpoint: "http://yoko.local",
			Timeout:  10 * time.Second,
			Auth:     config.MCPCodeModeQueryGenAuthConfig{Type: "static", StaticToken: "token"},
		},
		NamedOps: config.MCPCodeModeNamedOpsConfig{
			Enabled:        true,
			SessionTTL:     30 * time.Minute,
			MaxSessions:    1000,
			MaxBundleBytes: 256 << 10,
			Storage: config.MCPCodeModeNamedOpsStorageConfig{
				KeyPrefix: "cosmo_code_mode",
			},
		},
	}
}

func lifecycleTestSchema(t *testing.T) *ast.Document {
	t.Helper()
	doc, report := astparser.ParseGraphqlDocumentString(searchHandlerTestSchemaSDL)
	require.False(t, report.HasErrors(), report.Error())
	require.NoError(t, asttransform.MergeDefinitionWithBaseSchema(&doc))
	return &doc
}
