package integration

import (
	"context"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/goleak"
)

func TestShutdownGoroutineLeaks(t *testing.T) {
	defer goleak.VerifyNone(t,
		goleak.IgnoreTopFunction("github.com/hashicorp/consul/sdk/freeport.checkFreedPorts"), // Freeport, spawned by init
		goleak.IgnoreAnyFunction("net/http.(*conn).serve"),                                   // HTTPTest server I can't close if I want to keep the problematic goroutine open for the test
	)

	xEnv, err := testenv.CreateTestEnv(t, &testenv.Config{
		NoRetryClient:        true, // No need for this, just complicates the checks
		NoShutdownTestServer: true, // Shutting down test server will close idle connections

		RouterOptions: []core.Option{
			core.WithSubgraphTransportOptions(core.NewSubgraphTransportOptions(config.TrafficShapingRules{
				Subgraphs: map[string]*config.GlobalSubgraphRequestRule{
					"employees": {
						MaxIdleConns: integration.ToPtr(10),
					},
					"products": {
						MaxIdleConns: integration.ToPtr(10),
					},
					"mood": {
						MaxIdleConns: integration.ToPtr(10),
					},
				},
			})),
		},
	})
	require.NoError(t, err)

	{
		checkCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()

		_, err := xEnv.MakeGraphQLRequestWithContext(checkCtx, testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		require.NoError(t, err)
	}

	xEnv.Shutdown()

	{
		// Have to use background context since testenv context gets cancelled during Shutdown()
		res, err := xEnv.MakeGraphQLRequestWithContext(context.Background(), testenv.GraphQLRequest{
			Query: `query { employees { id } }`,
		})
		if assert.Error(t, err) {
			require.ErrorIs(t, err, syscall.ECONNREFUSED)
		}
		require.Nil(t, res)
	}
}
