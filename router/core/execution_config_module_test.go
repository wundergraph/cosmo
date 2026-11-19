package core

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

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
	beforeSwap  func()
	beforeRead  func()
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
	if m.beforeSwap != nil {
		m.beforeSwap()
	}
}

func (m *executionConfigTestModule) Middleware(ctx RequestContext, next http.Handler) {
	if m.beforeRead != nil && ctx.Request().Header.Get("X-Pause-Request") != "" {
		m.beforeRead()
	}
	if cfg, ok := ExecutionConfigFromContext(ctx.Request().Context()); ok {
		ctx.ResponseWriter().Header().Set("X-Supergraph-Hash", fmt.Sprintf("%x", sha256.Sum256([]byte(cfg.Schema()))))
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

func assertExecutionConfigRequest(t *testing.T, r *Router, sdl string, flag string) {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/graphql", strings.NewReader(`{"query":"{ hello }"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(featureFlagHeader, flag)
	r.httpServer.HttpServer().Handler.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	require.NotContains(t, w.Body.String(), `"errors"`)
	require.Contains(t, w.Body.String(), `"hello"`)
	require.Equal(t, fmt.Sprintf("%x", sha256.Sum256([]byte(sdl))), w.Header().Get("X-Supergraph-Hash"))
}

func TestModuleExecutionConfigChange(t *testing.T) {
	cfg, ok := ExecutionConfigFromContext(t.Context())
	require.False(t, ok)
	require.Equal(t, routerconfig.ExecutionConfig{}, cfg)

	t.Run("initial load and reload expose router SDL before activation", func(t *testing.T) {
		module := &executionConfigTestModule{}
		cfg := executionConfigWithDirective()
		r := newExecutionConfigTestRouter(t, cfg, module)
		module.beforeSwap = func() {
			require.True(t, module.provisioned)
			if len(module.updates) == 1 {
				require.Nil(t, r.httpServer.state.Load().graphServer)
			} else {
				// The candidate notification has already run, but the old graph
				// still accepts requests until this callback returns.
				assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "")
			}
		}
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)
		require.Len(t, module.updates, 1)
		require.Equal(t, cfg.EngineConfig.GraphqlSchema, module.updates[0].ExecutionConfig().Schema())
		require.Equal(t, cfg.Version, module.updates[0].ExecutionConfig().Version())
		require.Equal(t, cfg.EngineConfig.GetGraphqlClientSchema(), module.updates[0].ExecutionConfig().ClientSchema())
		require.Same(t, t.Context(), module.contexts[0])
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "")

		// Local composition can produce different SDL with the same version.
		updated := proto.Clone(cfg).(*nodev1.RouterConfig)
		updated.EngineConfig.GraphqlSchema = strings.ReplaceAll(cfg.EngineConfig.GraphqlSchema, "reader", "writer")
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{Config: updated}))
		require.Len(t, module.updates, 2)
		require.Equal(t, cfg.Version, module.updates[1].ExecutionConfig().Version())
		require.Equal(t, updated.EngineConfig.GraphqlSchema, module.updates[1].ExecutionConfig().Schema())
		require.Equal(t, cfg.EngineConfig.GraphqlSchema, module.updates[0].ExecutionConfig().Schema())
		require.Equal(t, updated.EngineConfig.GetGraphqlClientSchema(), module.updates[1].ExecutionConfig().ClientSchema())
		assertExecutionConfigRequest(t, r, updated.EngineConfig.GraphqlSchema, "")

		// Config updates with identical SDL must still notify the module.
		module.beforeSwap = nil
		configOnly := proto.Clone(updated).(*nodev1.RouterConfig)
		configOnly.Version = "config-only"
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{Config: configOnly}))
		require.Len(t, module.updates, 3)
		require.Equal(t, configOnly.Version, module.updates[2].ExecutionConfig().Version())
		require.Equal(t, updated.EngineConfig.GraphqlSchema, module.updates[2].ExecutionConfig().Schema())
		assertExecutionConfigRequest(t, r, updated.EngineConfig.GraphqlSchema, "")
	})

	t.Run("an old request first reads its snapshot after the replacement serves traffic", func(t *testing.T) {
		cfg := executionConfigWithDirective()
		entered, resume := make(chan struct{}), make(chan struct{})
		release := sync.OnceFunc(func() { close(resume) })
		defer release()
		module := &executionConfigTestModule{beforeRead: func() {
			close(entered)
			<-resume
		}}
		r := newExecutionConfigTestRouter(t, cfg, module)
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)
		oldServer := r.httpServer.state.Load().graphServer

		response := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/graphql", strings.NewReader(`{"query":"{ hello }"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Pause-Request", "true")
		done := make(chan struct{})
		go func() {
			defer close(done)
			r.httpServer.HttpServer().Handler.ServeHTTP(response, req)
		}()
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("old request did not enter middleware")
		}

		updated := proto.Clone(cfg).(*nodev1.RouterConfig)
		updated.EngineConfig.GraphqlSchema = strings.ReplaceAll(cfg.EngineConfig.GraphqlSchema, "reader", "writer")
		reloaded := make(chan error, 1)
		go func() { reloaded <- r.newServer(t.Context(), &routerconfig.Response{Config: updated}) }()
		require.Eventually(t, func() bool { return r.httpServer.state.Load().graphServer != oldServer }, 5*time.Second, time.Millisecond)
		assertExecutionConfigRequest(t, r, updated.EngineConfig.GraphqlSchema, "")
		release()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("old request did not finish")
		}
		require.NoError(t, <-reloaded)
		require.Equal(t, http.StatusOK, response.Code)
		require.NotContains(t, response.Body.String(), `"errors"`)
		require.Contains(t, response.Body.String(), `"hello"`)
		require.Equal(t, fmt.Sprintf("%x", sha256.Sum256([]byte(cfg.EngineConfig.GraphqlSchema))), response.Header().Get("X-Supergraph-Hash"))
	})

	t.Run("feature configs follow their mux across reloads", func(t *testing.T) {
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

		flag := func(name, greeting string) *nodev1.FeatureFlagRouterExecutionConfig {
			engine := executionConfigWithDirective().EngineConfig
			engine.GraphqlSchema = fmt.Sprintf(`directive @translate(to: String!) on FIELD_DEFINITION
type Query { hello: String @translate(to: %q) }`, greeting)
			return &nodev1.FeatureFlagRouterExecutionConfig{
				Version: name + "-version", EngineConfig: engine,
				Subgraphs: []*nodev1.Subgraph{{Id: name, Name: name + "-products"}},
			}
		}
		german, french := flag("german", "Hallo"), flag("french", "Bonjour")
		german.EngineConfig.GraphqlClientSchema = nil
		updated := proto.Clone(cfg).(*nodev1.RouterConfig)
		updated.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{"german": german, "french": french},
		}
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{
			Config: updated, Changes: &routerconfig.Changes{AddedConfigs: map[string]struct{}{"german": {}, "french": {}}},
		}))
		require.Same(t, baseMux, r.httpServer.state.Load().graphServer.graphMuxList[""])
		require.Len(t, module.updates, 2)
		both := module.updates[1]
		require.Equal(t, want, both.ExecutionConfig().Subgraphs())
		de, ok := both.FeatureFlagConfig("german")
		require.True(t, ok)
		require.Equal(t, german.Version, de.Version())
		require.Equal(t, german.EngineConfig.GraphqlSchema, de.Schema())
		require.Equal(t, de.Schema(), de.ClientSchema())
		require.Equal(t, []routerconfig.Subgraph{{ID: "german", Name: "german-products"}}, de.Subgraphs())
		fr, ok := both.FeatureFlagConfig("french")
		require.True(t, ok)
		require.Equal(t, french.EngineConfig.GraphqlSchema, fr.Schema())
		require.Equal(t, french.EngineConfig.GetGraphqlClientSchema(), fr.ClientSchema())
		for _, name := range []string{"", "unknown", "German"} {
			missing, ok := both.FeatureFlagConfig(name)
			require.False(t, ok)
			require.Equal(t, routerconfig.ExecutionConfig{}, missing)
		}

		assertExecutionConfigRequest(t, r, de.Schema(), "german")
		module.beforeSwap = func() {
			// The new config has removed German. The old mux can still serve it.
			assertExecutionConfigRequest(t, r, de.Schema(), "german")
		}
		next := proto.Clone(updated).(*nodev1.RouterConfig)
		delete(next.FeatureFlagConfigs.ConfigByFeatureFlagName, "german")
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{
			Config: next, Changes: &routerconfig.Changes{RemovedConfigs: map[string]struct{}{"german": {}}},
		}))
		require.Len(t, module.updates, 3)
		missing, ok := module.updates[2].FeatureFlagConfig("german")
		require.False(t, ok)
		require.Equal(t, routerconfig.ExecutionConfig{}, missing)
		reused, ok := module.updates[2].FeatureFlagConfig("french")
		require.True(t, ok)
		require.True(t, fr == reused, "reused graphs keep their snapshot identity")
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "german")
		retained, ok := both.FeatureFlagConfig("german")
		require.True(t, ok)
		require.Equal(t, de, retained)
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
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "")
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
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "")

		invalid = proto.Clone(cfg).(*nodev1.RouterConfig)
		invalidClientSchema := "type Query {"
		invalid.EngineConfig.GraphqlClientSchema = &invalidClientSchema
		require.Error(t, r.newServer(t.Context(), &routerconfig.Response{Config: invalid}))
		require.Len(t, module.updates, 1)
		require.Equal(t, cfg.EngineConfig.GetGraphqlClientSchema(), module.updates[0].ExecutionConfig().ClientSchema())
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "")

		// A failure after a valid base graph has been built must not notify either.
		invalid = proto.Clone(cfg).(*nodev1.RouterConfig)
		invalid.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
			ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
				"invalid": {EngineConfig: &nodev1.EngineConfiguration{GraphqlSchema: "type Query {"}},
			},
		}
		require.Error(t, r.newServer(t.Context(), &routerconfig.Response{Config: invalid}))
		require.Len(t, module.updates, 1)
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "")
	})
}
