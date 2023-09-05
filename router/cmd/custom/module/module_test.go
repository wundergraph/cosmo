package module

import (
	"bytes"
	"context"
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/app"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"net/http/httptest"
	"testing"
)

func TestMyModule(t *testing.T) {

	ctx := context.Background()
	cfg := config.Config{
		FederatedGraphName: "production",
		Modules: map[string]interface{}{
			"myModule": MyModule{
				Value: 1,
			},
		},
	}

	routerConfig, err := app.SerializeConfigFromFile("./router-config.json")
	assert.Nil(t, err)

	rs, err := app.New(
		app.WithFederatedGraphName(cfg.FederatedGraphName),
		app.WithStaticRouterConfig(routerConfig),
		app.WithModulesConfig(cfg.Modules),
		app.WithListenerAddr("http://localhost:3002"),
	)
	assert.Nil(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	router, err := rs.NewTestRouter(ctx)
	assert.Nil(t, err)

	rr := httptest.NewRecorder()

	var jsonData = []byte(`{
		"query": "query MyQuery { employees { id } }",
		"operationName": "MyQuery"
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(jsonData))
	router.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)

	// This header was set by the module
	assert.Equal(t, rr.Result().Header.Get("myHeader"), "myValue")

	assert.JSONEq(t, rr.Body.String(), `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12},{"id":13}]}}`)
}
