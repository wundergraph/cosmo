package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
)

type captureGraphRequest struct {
	ctx context.Context
}

func (m *captureGraphRequest) Module() ModuleInfo {
	return ModuleInfo{ID: "captureGraphRequest", New: func() Module { return m }}
}

func (m *captureGraphRequest) RouterOnRequest(ctx RequestContext, _ http.Handler) {
	m.ctx = ctx.Request().Context()
	ctx.ResponseWriter().WriteHeader(http.StatusNoContent)
}

func TestExecutionConfigFromContext(t *testing.T) {
	t.Parallel()

	missing := ExecutionConfigFromContext(t.Context())
	require.Nil(t, missing)
	require.Empty(t, missing.Schema())
	require.Empty(t, missing.ClientSchema())
	require.Nil(t, missing.Subgraphs())

	base := routerconfig.GetDefaultConfig()
	flagged := routerconfig.GetDefaultConfig()
	flagged.EngineConfig.GraphqlSchema = "type Query { hello: String! }"
	initial := routerconfig.GetDefaultConfig()
	initial.FeatureFlagConfigs = &nodev1.FeatureFlagRouterExecutionConfigs{
		ConfigByFeatureFlagName: map[string]*nodev1.FeatureFlagRouterExecutionConfig{
			"preview": {Version: base.Version, EngineConfig: flagged.EngineConfig},
		},
	}

	module := &captureGraphRequest{}
	r, err := NewRouter(t.Context(),
		WithListenerAddr("127.0.0.1:0"),
		WithDisableUsageTracking(),
		WithBatching(&BatchingConfig{}),
		WithStaticExecutionConfig(initial),
		WithCustomModules(module),
	)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, r.Shutdown(context.Background())) })
	_, err = r.NewServer(t.Context())
	require.NoError(t, err)

	request := func(flag string) context.Context {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		req.Header.Set(featureFlagHeader, flag)
		response := httptest.NewRecorder()
		r.httpServer.HttpServer().Handler.ServeHTTP(response, req)
		require.Equal(t, http.StatusNoContent, response.Code)
		return module.ctx
	}

	baseConfig := ExecutionConfigFromContext(request(""))
	require.NotNil(t, baseConfig)
	oldRequest := request("preview")
	otherPreviewRequest := request("preview")
	require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{
		Config:  base,
		Changes: &routerconfig.Changes{RemovedConfigs: map[string]struct{}{"preview": {}}},
	}))

	// Once the flag is removed, new requests fall back to base. The old
	// request still identifies its graph when first read after the reload.
	fallback := ExecutionConfigFromContext(request("preview"))
	require.Equal(t, base.EngineConfig.GraphqlSchema, fallback.Schema())
	require.Same(t, baseConfig, fallback, "the base graph was reused")
	oldConfig := ExecutionConfigFromContext(oldRequest)
	require.Equal(t, flagged.EngineConfig.GraphqlSchema, oldConfig.Schema())
	require.NotSame(t, baseConfig, oldConfig, "the flag and base graph share a version")
	require.Same(t, oldConfig, ExecutionConfigFromContext(otherPreviewRequest))

	require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{Config: base}))
	rebuilt := ExecutionConfigFromContext(request(""))
	require.NotNil(t, rebuilt)
	require.NotSame(t, baseConfig, rebuilt, "rebuilding the identical config creates a new snapshot")
}
