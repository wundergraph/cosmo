package integration

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.uber.org/goleak"
)

func TestRouterSupervisor(t *testing.T) {
	defer goleak.VerifyNone(t,
		// Freeport, spawned by init
		goleak.IgnoreTopFunction("github.com/wundergraph/cosmo/router-tests/freeport.checkFreedPorts"),
		// HTTPTest server I can't close if I want to keep the problematic goroutine open for the test
		goleak.IgnoreAnyFunction("net/http.(*conn).serve"),
	)

	xEnv, err := testenv.CreateTestSupervisorEnv(t, &testenv.Config{})
	require.NoError(t, err)

	stopped := make(chan struct{})
	go func() {
		xEnv.RouterSupervisor.Start()
		close(stopped)
	}()

	// Ready 1
	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 2000, 30)
	require.NoError(t, err, "ready 1 timed out")

	// Reload the router
	xEnv.RouterSupervisor.Reload()

	// Ready 2
	err = xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 2000, 30)
	require.NoError(t, err, "ready 2 timed out")

	// Shutdown the router and all the httptest servers
	xEnv.RouterSupervisor.Stop()
	xEnv.Shutdown()

	<-stopped
}
