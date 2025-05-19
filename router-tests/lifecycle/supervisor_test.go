package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/goleak"
)

func TestRouterSupervisor(t *testing.T) {
	defer goleak.VerifyNone(t,
		goleak.IgnoreTopFunction("github.com/hashicorp/consul/sdk/freeport.checkFreedPorts"), // Freeport, spawned by init
		goleak.IgnoreAnyFunction("net/http.(*conn).serve"),                                   // HTTPTest server I can't close if I want to keep the problematic goroutine open for the test
	)

	xEnv, err := testenv.CreateTestSupervisorEnv(t, &testenv.Config{
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

	go xEnv.RouterSupervisor.Start()

	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 250, 30)
	require.NoError(t, err)

	xEnv.RouterSupervisor.Reload()

	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 250, 30)
	require.NoError(t, err)

	xEnv.RouterSupervisor.Stop()
	xEnv.Shutdown()

	time.Sleep(1 * time.Second)

	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 250, 1)
	require.Error(t, err)
}
