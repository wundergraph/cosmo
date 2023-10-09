package integration_test

import (
	"bytes"
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/cmd/custom/module"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestMyModule(t *testing.T) {

	ctx := context.Background()
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

	routerConfig, err := core.SerializeConfigFromFile(filepath.Join("testdata", "config.json"))
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
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
