package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	natsPubsub "github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"go.uber.org/zap"
	"google.golang.org/protobuf/encoding/protojson"
)

func TestNewServer(t *testing.T) {
	t.Parallel()

	t.Run("creates a working server without starting a listener", func(t *testing.T) {
		t.Parallel()

		rr, cleanup := setupNewServerTest(t)
		defer cleanup()

		svr, err := rr.NewServer(t.Context())
		require.NoError(t, err)

		svr.HealthChecks().SetReady(true)
		ts := httptest.NewServer(svr.HttpServer().Handler)
		defer ts.Close()

		data, err := json.Marshal(testenv.GraphQLRequest{Query: `query { employees { id } }`})
		require.NoError(t, err)

		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, ts.URL+"/graphql", bytes.NewReader(data))
		require.NoError(t, err)

		response, err := testenv.MakeGraphQLRequestRawFromClient(req, &http.Client{})
		require.NoError(t, err)

		require.Equal(t, http.StatusOK, response.Response.StatusCode)
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, response.Body)
	})

	t.Run("health check endpoint is reachable", func(t *testing.T) {
		t.Parallel()

		rr, cleanup := setupNewServerTest(t)
		defer cleanup()

		svr, err := rr.NewServer(t.Context())
		require.NoError(t, err)

		svr.HealthChecks().SetReady(true)
		ts := httptest.NewServer(svr.HttpServer().Handler)
		defer ts.Close()

		resp, err := http.Get(ts.URL + "/health/ready")
		require.NoError(t, err)
		defer func() {
			_ = resp.Body.Close()
		}()
		require.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("new server shutdown prevents further requests", func(t *testing.T) {
		t.Parallel()

		rr, cleanup := setupNewServerTest(t)
		defer cleanup()

		svr, err := rr.NewServer(t.Context())
		require.NoError(t, err)

		svr.HealthChecks().SetReady(true)
		ts := httptest.NewServer(svr.HttpServer().Handler)

		// Verify the server works before shutdown
		data, err := json.Marshal(testenv.GraphQLRequest{Query: `query { employees { id } }`})
		require.NoError(t, err)

		req, err := http.NewRequestWithContext(t.Context(), http.MethodPost, ts.URL+"/graphql", bytes.NewReader(data))
		require.NoError(t, err)

		response1, err := testenv.MakeGraphQLRequestRawFromClient(req, &http.Client{})
		require.NoError(t, err)

		require.Equal(t, http.StatusOK, response1.Response.StatusCode)
		require.JSONEq(t, `{"data":{"employees":[{"id":1},{"id":2},{"id":3},{"id":4},{"id":5},{"id":7},{"id":8},{"id":10},{"id":11},{"id":12}]}}`, response1.Body)

		// Shutdown
		ts.Close()

		ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
		defer cancel()
		req, err = http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/graphql", bytes.NewReader(data))
		require.NoError(t, err)

		_, err = testenv.MakeGraphQLRequestRawFromClient(req, &http.Client{})
		require.Error(t, err)
	})
}

func setupNewServerTest(t *testing.T) (rr *core.Router, cleanup func()) {
	t.Helper()

	employeesServer := httptest.NewServer(subgraphs.EmployeesHandler(&subgraphs.SubgraphOptions{
		NatsPubSubByProviderID: map[string]natsPubsub.Adapter{},
	}))

	// Build the router config from the embedded template
	replaced := testenv.ConfigJSONTemplate
	replacements := map[string]string{
		subgraphs.EmployeesDefaultDemoURL: testenv.GqlURL(employeesServer),
	}
	for k, v := range replacements {
		replaced = strings.ReplaceAll(replaced, k, v)
	}

	var routerConfig nodev1.RouterConfig
	require.NoError(t, protojson.Unmarshal([]byte(replaced), &routerConfig))

	rr, err := core.NewRouter(
		core.WithDisableUsageTracking(),
		core.WithLogger(zap.NewNop()),
		core.WithDevelopmentMode(true),
		core.WithStaticExecutionConfig(&routerConfig),
		core.WithEngineExecutionConfig(config.EngineExecutionConfiguration{}),
		core.WithBatching(&core.BatchingConfig{}),
	)
	require.NoError(t, err)

	allServers := []*httptest.Server{employeesServer}

	return rr, func() {
		_ = rr.Shutdown(t.Context())
		for _, s := range allServers {
			s.Close()
		}
	}
}
