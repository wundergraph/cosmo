package integration

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/routerconfig"
	"github.com/wundergraph/cosmo/router/config"
	"github.com/wundergraph/cosmo/router/core"
)

func TestSubgraphReturnsSuccessfully(t *testing.T) {

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := []byte(fmt.Sprintf(`{"data":{"hello": "%s"}}`, "John Doe"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	defer srv.Close()

	ctx := context.Background()

	subgraphs := []*routerconfig.Subgraph{
		{
			Name:   "employees",
			URL:    srv.URL,
			Schema: `type Query { hello: String! }`,
		},
	}

	configFile, err := routerconfig.SerializeSubgraphs(subgraphs)
	require.NoError(t, err)

	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithListenerAddr("localhost:3002"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(t, err)

	rr := httptest.NewRecorder()

	queryData := []byte(`{
		"query": "query { hello }",
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(queryData))
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"data":{"hello": "John Doe"}}`), rr.Body.String())
}

func TestSubgraphReturnsGraphQLErrorWithNullData(t *testing.T) {

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := []byte(`{"errors":[{"message":"Something went wrong"}],"data":null}`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	defer srv.Close()

	ctx := context.Background()

	subgraphs := []*routerconfig.Subgraph{
		{
			Name:   "employees",
			URL:    srv.URL,
			Schema: `type Query { hello: String! }`,
		},
	}

	configFile, err := routerconfig.SerializeSubgraphs(subgraphs)
	require.NoError(t, err)

	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithListenerAddr("localhost:3002"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(t, err)

	rr := httptest.NewRecorder()

	queryData := []byte(`{
		"query": "query { hello }",
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(queryData))
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"errors":[{"message":"Something went wrong"}],"data":null}`), rr.Body.String())
	if t.Failed() {
		t.Log(rr.Body.String())
	}
}

func TestSubgraphReturnsGraphQLErrorWithMissingData(t *testing.T) {

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := []byte(`{"errors":[{"message":"Something went wrong"}]}`)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	defer srv.Close()

	ctx := context.Background()

	subgraphs := []*routerconfig.Subgraph{
		{
			Name:   "employees",
			URL:    srv.URL,
			Schema: `type Query { hello: String! }`,
		},
	}

	configFile, err := routerconfig.SerializeSubgraphs(subgraphs)
	require.NoError(t, err)

	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithListenerAddr("localhost:3002"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(t, err)

	rr := httptest.NewRecorder()

	queryData := []byte(`{
		"query": "query { hello }",
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(queryData))
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"errors":[{"message":"Something went wrong"}],"data":null}`), rr.Body.String())
	if t.Failed() {
		t.Log(rr.Body.String())
	}
}

func TestSubgraphReturnsHttpError(t *testing.T) {

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	ctx := context.Background()

	subgraphs := []*routerconfig.Subgraph{
		{
			Name:   "employees",
			URL:    srv.URL,
			Schema: `type Query { hello: String! }`,
		},
	}

	configFile, err := routerconfig.SerializeSubgraphs(subgraphs)
	require.NoError(t, err)

	cfg := config.Config{
		Graph: config.Graph{
			Name: "production",
		},
	}

	routerConfig, err := core.SerializeConfigFromFile(configFile)
	require.NoError(t, err)

	rs, err := core.NewRouter(
		core.WithFederatedGraphName(cfg.Graph.Name),
		core.WithStaticRouterConfig(routerConfig),
		core.WithModulesConfig(cfg.Modules),
		core.WithListenerAddr("localhost:3002"),
	)
	require.NoError(t, err)
	t.Cleanup(func() {
		assert.Nil(t, rs.Shutdown(ctx))
	})

	server, err := rs.NewTestServer(ctx)
	require.NoError(t, err)

	rr := httptest.NewRecorder()

	queryData := []byte(`{
		"query": "query { hello }",
	}`)
	req := httptest.NewRequest("POST", "/graphql", bytes.NewBuffer(queryData))
	server.Server.Handler.ServeHTTP(rr, req)

	assert.Equal(t, 200, rr.Code)
	assert.JSONEq(t, fmt.Sprintf(`{"errors":[{"message":"origin server returned non-200 status code"}],"data":null}`), rr.Body.String())
	if t.Failed() {
		t.Log(rr.Body.String())
	}
}
