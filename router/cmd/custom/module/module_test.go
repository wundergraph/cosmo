package module

import (
	"bytes"
	"context"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/internal/config"
	"net/http/httptest"
	"os"
	"testing"
)

func TestMyModule(t *testing.T) {

	if os.Getenv("MODULE_TESTS") == "" {
		t.Skip("Skipping testing in CI environment")
	}

	ctx := context.Background()
	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
		Modules: map[string]interface{}{
			"myModule": MyModule{
				Value: 1,
			},
		},
	}

	routerConfig, err := core.SerializeConfigFromFile("./router-config.json")
	assert.Nil(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithListenerAddr("http://localhost:3002"),
	)
	assert.Nil(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	assert.Nil(t, err)

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

	assert.JSONEq(t, rr.Body.String(), `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12},{"id":13}]}}`)
}
