package core

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

type executionConfigTestModule struct {
	provisioned bool
	updates     []ModuleConfig
	contexts    []context.Context
	current     atomic.Value
	beforeSwap  func()
}

func (m *executionConfigTestModule) Module() ModuleInfo {
	return ModuleInfo{ID: "executionConfigTest", New: func() Module { return m }}
}

func (m *executionConfigTestModule) Provision(*ModuleContext) error {
	m.provisioned = true
	return nil
}

func (m *executionConfigTestModule) OnConfigChange(ctx context.Context, cfg ModuleConfig) {
	m.updates = append(m.updates, cfg)
	m.contexts = append(m.contexts, ctx)
	m.current.Store(cfg)
	if m.beforeSwap != nil {
		m.beforeSwap()
	}
}

func (m *executionConfigTestModule) Middleware(ctx RequestContext, next http.Handler) {
	if snapshot := m.current.Load(); snapshot != nil {
		ctx.ResponseWriter().Header().Set("X-Supergraph-Hash", fmt.Sprintf("%x", sha256.Sum256([]byte(snapshot.(ModuleConfig).ExecutionConfig().Schema()))))
	}
	next.ServeHTTP(ctx.ResponseWriter(), ctx.Request())
}

// This module deliberately implements none of the optional lifecycle hooks.
type executionConfigLegacyModule struct{}

func (*executionConfigLegacyModule) Module() ModuleInfo {
	return ModuleInfo{ID: "legacy", New: func() Module { return &executionConfigLegacyModule{} }}
}

func executionConfigWithDirective() *nodev1.RouterConfig {
	cfg := routerconfig.GetDefaultConfig()
	cfg.Version = "constant-version"
	cfg.EngineConfig.GraphqlSchema = `schema { query: Query }
directive @modulePolicy(role: String!) on FIELD_DEFINITION
type Query { hello: String @modulePolicy(role: "reader") }`
	clientSDL := "schema { query: Query } type Query { hello: String }"
	cfg.EngineConfig.GraphqlClientSchema = &clientSDL
	return cfg
}

func newExecutionConfigTestRouter(t *testing.T, cfg *nodev1.RouterConfig, module *executionConfigTestModule) *Router {
	t.Helper()
	r, err := NewRouter(t.Context(),
		WithLogger(zap.NewNop()),
		WithListenerAddr("127.0.0.1:0"),
		WithDisableUsageTracking(),
		WithBatching(&BatchingConfig{}),
		WithStaticExecutionConfig(cfg),
		WithCustomModules(module, &executionConfigLegacyModule{}),
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, r.Shutdown(context.Background())) })
	return r
}

func assertExecutionConfigRequest(t *testing.T, r *Router, sdl string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/graphql", strings.NewReader(`{"query":"{ hello }"}`))
	req.Header.Set("Content-Type", "application/json")
	r.httpServer.HttpServer().Handler.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	require.NotContains(t, w.Body.String(), `"errors"`)
	require.Contains(t, w.Body.String(), `"hello"`)
	require.Equal(t, fmt.Sprintf("%x", sha256.Sum256([]byte(sdl))), w.Header().Get("X-Supergraph-Hash"))
}

func TestModuleExecutionConfigChange(t *testing.T) {
	t.Run("initial load and reload expose router SDL before activation", func(t *testing.T) {
		module := &executionConfigTestModule{}
		cfg := executionConfigWithDirective()
		r := newExecutionConfigTestRouter(t, cfg, module)
		module.beforeSwap = func() {
			require.True(t, module.provisioned)
			if len(module.updates) == 1 {
				require.Nil(t, r.httpServer.state.Load().graphServer)
			} else {
				require.Equal(t, cfg.Version, r.httpServer.state.Load().graphServer.baseRouterConfigVersion)
			}
		}
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)
		require.Len(t, module.updates, 1)
		require.Equal(t, cfg.EngineConfig.GraphqlSchema, module.updates[0].ExecutionConfig().Schema())
		require.Equal(t, cfg.Version, module.updates[0].ExecutionConfig().Version())
		require.Equal(t, cfg.EngineConfig.GetGraphqlClientSchema(), module.updates[0].ExecutionConfig().ClientSchema())
		require.Same(t, t.Context(), module.contexts[0])
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema)

		// Local composition can produce different SDL with the same version.
		updated := proto.Clone(cfg).(*nodev1.RouterConfig)
		updated.EngineConfig.GraphqlSchema = strings.ReplaceAll(cfg.EngineConfig.GraphqlSchema, "reader", "writer")
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{Config: updated}))
		require.Len(t, module.updates, 2)
		require.Equal(t, cfg.Version, module.updates[1].ExecutionConfig().Version())
		require.Equal(t, updated.EngineConfig.GraphqlSchema, module.updates[1].ExecutionConfig().Schema())
		require.Equal(t, cfg.EngineConfig.GraphqlSchema, module.updates[0].ExecutionConfig().Schema())
		require.Equal(t, updated.EngineConfig.GetGraphqlClientSchema(), module.updates[1].ExecutionConfig().ClientSchema())
		assertExecutionConfigRequest(t, r, updated.EngineConfig.GraphqlSchema)

		// Config updates with identical SDL must still notify the module.
		module.beforeSwap = nil
		configOnly := proto.Clone(updated).(*nodev1.RouterConfig)
		configOnly.Version = "config-only"
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{Config: configOnly}))
		require.Len(t, module.updates, 3)
		require.Equal(t, configOnly.Version, module.updates[2].ExecutionConfig().Version())
		require.Equal(t, updated.EngineConfig.GraphqlSchema, module.updates[2].ExecutionConfig().Schema())
		assertExecutionConfigRequest(t, r, updated.EngineConfig.GraphqlSchema)
	})

	t.Run("feature-only reload retains the base subgraph inventory", func(t *testing.T) {
		module := &executionConfigTestModule{}
		cfg := executionConfigWithDirective()
		cfg.Subgraphs = []*nodev1.Subgraph{
			{Id: "1", Name: "products", RoutingUrl: "https://products.example/graphql"},
			{Id: "2", Name: "virtual"},
		}
		r := newExecutionConfigTestRouter(t, cfg, module)
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)
		want := []routerconfig.Subgraph{
			{ID: "1", Name: "products", RoutingURL: "https://products.example/graphql"},
			{ID: "2", Name: "virtual"},
		}
		require.Len(t, module.updates, 1)
		require.Equal(t, want, module.updates[0].ExecutionConfig().Subgraphs())
		baseMux := r.httpServer.state.Load().graphServer.graphMuxList[""]

		updated := proto.Clone(cfg).(*nodev1.RouterConfig)
		updated.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"preview": {
					Version: "preview", EngineConfig: executionConfigWithDirective().EngineConfig,
					Subgraphs: []*nodev1.Subgraph{{Id: "3", Name: "preview-products"}},
				},
			},
		}
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{
			Config: updated, Changes: &routerconfig.Changes{AddedConfigs: map[string]struct{}{"preview": {}}},
		}))
		require.Same(t, baseMux, r.httpServer.state.Load().graphServer.graphMuxList[""])
		require.Len(t, module.updates, 2)
		require.Equal(t, want, module.updates[1].ExecutionConfig().Subgraphs())
	})

	t.Run("client schema defaults to router schema", func(t *testing.T) {
		module := &executionConfigTestModule{}
		cfg := executionConfigWithDirective()
		cfg.EngineConfig.GraphqlClientSchema = nil
		r := newExecutionConfigTestRouter(t, cfg, module)
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)
		require.Len(t, module.updates, 1)
		require.Equal(t, cfg.EngineConfig.GraphqlSchema, module.updates[0].ExecutionConfig().ClientSchema())
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema)
	})

	t.Run("failed startup does not notify", func(t *testing.T) {
		module := &executionConfigTestModule{}
		cfg := executionConfigWithDirective()
		cfg.EngineConfig.GraphqlSchema = "type Query {"
		r := newExecutionConfigTestRouter(t, cfg, module)
		_, err := r.NewServer(t.Context())
		require.Error(t, err)
		require.Empty(t, module.updates)
	})

	t.Run("failed reload keeps active schema and module metadata", func(t *testing.T) {
		module := &executionConfigTestModule{}
		cfg := executionConfigWithDirective()
		r := newExecutionConfigTestRouter(t, cfg, module)
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)

		invalid := proto.Clone(cfg).(*nodev1.RouterConfig)
		invalid.Version = "rejected"
		invalid.EngineConfig.GraphqlSchema = "type Query {"
		require.Error(t, r.newServer(t.Context(), &routerconfig.Response{Config: invalid}))
		require.Len(t, module.updates, 1)
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema)

		invalid = proto.Clone(cfg).(*nodev1.RouterConfig)
		invalidClientSchema := "type Query {"
		invalid.EngineConfig.GraphqlClientSchema = &invalidClientSchema
		require.Error(t, r.newServer(t.Context(), &routerconfig.Response{Config: invalid}))
		require.Len(t, module.updates, 1)
		require.Equal(t, cfg.EngineConfig.GetGraphqlClientSchema(), module.updates[0].ExecutionConfig().ClientSchema())
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema)

		// A failure after a valid base graph has been built must not notify either.
		invalid = proto.Clone(cfg).(*nodev1.RouterConfig)
		invalid.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"invalid": {EngineConfig: &nodev1.EngineConfiguration{GraphqlSchema: "type Query {"}},
			},
		}
		require.Error(t, r.newServer(t.Context(), &routerconfig.Response{Config: invalid}))
		require.Len(t, module.updates, 1)
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema)
	})
}
