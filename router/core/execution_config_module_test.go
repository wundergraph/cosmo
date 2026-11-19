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
	beforeRead func()
}

func (m *executionConfigTestModule) Module() ModuleInfo {
	return ModuleInfo{ID: "executionConfigTest", New: func() Module { return m }}
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
		WithCustomModules(module),
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

func TestExecutionConfigFromContext(t *testing.T) {
	cfg, ok := ExecutionConfigFromContext(t.Context())
	require.False(t, ok)
	require.Equal(t, routerconfig.ExecutionConfig{}, cfg)

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
		r := newExecutionConfigTestRouter(t, cfg, module)
		_, err := r.NewServer(t.Context())
		require.NoError(t, err)
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
		assertExecutionConfigRequest(t, r, german.EngineConfig.GraphqlSchema, "german")
		assertExecutionConfigRequest(t, r, french.EngineConfig.GraphqlSchema, "french")

		next := proto.Clone(updated).(*nodev1.RouterConfig)
		delete(next.FeatureFlagConfigs.ConfigByFeatureFlagName, "german")
		require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{
			Config: next, Changes: &routerconfig.Changes{RemovedConfigs: map[string]struct{}{"german": {}}},
		}))
		assertExecutionConfigRequest(t, r, cfg.EngineConfig.GraphqlSchema, "german")
		assertExecutionConfigRequest(t, r, french.EngineConfig.GraphqlSchema, "french")
	})
}
