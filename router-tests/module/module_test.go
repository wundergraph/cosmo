package module_test

import (
	"bytes"
	"context"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/routerconfig"
	"github.com/wundergraph/cosmo/router-tests/runner"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestMyModule(t *testing.T) {

	ctx := context.Background()

	r, err := runner.NewInProcessSubgraphsRunner(nil)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, r.Stop(ctx))
	})
	go func() {
		err := r.Start(ctx)
		assert.NoError(t, err)
	}()

	err = runner.Wait(ctx, r)
	require.NoError(t, err)

	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
		Modules: map[string]interface{}{
			"myModule": module.MyModule{
				Value: 1,
			},
		},
	}

	configFile, err := routerconfig.SerializeRunner(r)
	require.NoError(t, err)

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithDevelopmentMode(true),
		core.WithListenerAddr("http://localhost:3002"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(t, err)

	rr := httptest.NewRecorder()

	var jsonData = []byte(`{
		"query": "query MyQuery { employees { id } }",
		"operationName": "MyQuery"
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(jsonData))
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)

	// This header was set by the module
	assert.Equal(t, rr.Result().Header.Get("myHeader"), "myValue")

	assert.JSONEq(t, rr.Body.String(), `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`)
}
