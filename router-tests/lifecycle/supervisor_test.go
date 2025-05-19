package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/goleak"
)

func TestRouterSupervisor(t *testing.T) {
	defer goleak.VerifyNone(t,
		goleak.IgnoreTopFunction("github.com/hashicorp/consul/sdk/freeport.checkFreedPorts"), // Freeport, spawned by init
		goleak.IgnoreAnyFunction("net/http.(*conn).serve"),                                   // HTTPTest server I can't close if I want to keep the problematic goroutine open for the test
	)

	xEnv, err := testenv.CreateTestSupervisorEnv(t, &testenv.Config{})
	require.NoError(t, err)

	// Start in untracked goroutine, should get cleaned up automatically
	go xEnv.RouterSupervisor.Start()

	// Ready 1
	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 250, 30)
	require.NoError(t, err, "ready 1 timed out")

	// Reload the router
	xEnv.RouterSupervisor.Reload()

	// Ready 2
	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 500, 30)
	require.NoError(t, err, "ready 2 timed out")

	// Shutdown the router and all the httptest servers
	xEnv.RouterSupervisor.Stop()
	xEnv.Shutdown()

	// Let everything settle
	time.Sleep(1 * time.Second)

	// Should fail, since everything should be off now
	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 250, 1)
	require.Error(t, err)
}
