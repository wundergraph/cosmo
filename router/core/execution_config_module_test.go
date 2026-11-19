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

	require.Equal(t, routerconfig.ExecutionConfig{}, ExecutionConfigFromContext(t.Context()))

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

	previewRequest := func() context.Context {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
		req.Header.Set(featureFlagHeader, "preview")
		response := httptest.NewRecorder()
		r.httpServer.HttpServer().Handler.ServeHTTP(response, req)
		require.Equal(t, http.StatusNoContent, response.Code)
		return module.ctx
	}

	oldRequest := previewRequest()
	otherPreviewRequest := previewRequest()
	require.NoError(t, r.newServer(t.Context(), &routerconfig.Response{Config: base}))

	// Once the flag is removed, new requests fall back to base. The old
	// request still identifies its graph when first read after the reload.
	require.Equal(t, base.EngineConfig.GraphqlSchema, ExecutionConfigFromContext(previewRequest()).Schema())
	oldConfig := ExecutionConfigFromContext(oldRequest)
	require.Equal(t, flagged.EngineConfig.GraphqlSchema, oldConfig.Schema())
	require.True(t, oldConfig == ExecutionConfigFromContext(otherPreviewRequest), "requests to the same graph must share a cache key")
}
