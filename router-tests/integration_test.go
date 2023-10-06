package module

import (
	"bytes"
	"context"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestIntegration(t *testing.T) {

	ctx := context.Background()
	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(filepath.Join("testdata", "config.json"))
	require.Nil(t, err)

	sg, err := subgraphs.New(&subgraphs.Config{
		Ports: subgraphs.Ports{
			Employees: 4001,
			Family:    4002,
			Hobbies:   4003,
			Products:  4004,
		},
	})
	require.Nil(t, err)

	go func() {
		require.Nil(t, sg.ListenAndServe(ctx))
	}()
	t.Cleanup(func() {
		assert.Nil(t, sg.Shutdown(ctx))
	})

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithListenerAddr("http://localhost:3002"),
	)
	require.Nil(t, err)

	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.Nil(t, err)

	rr := httptest.NewRecorder()

	var jsonData = []byte(`{
		"query": "query MyQuery { employees { id } }",
		"operationName": "MyQuery"
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(jsonData))
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)

	assert.JSONEq(t, rr.Body.String(), `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":9},{"id":10},{"id":11},{"id":12}]}}`)
}
