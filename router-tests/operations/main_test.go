package integration

import (
	"context"
	"fmt"
	"os"
	"testing"

	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/core"
)

// planWorkerProcessEnv makes the test binary act as a plan worker process instead of
// running tests. The router starts its plan workers from its own binary, which is this
// test binary when the router runs inside a test.
const planWorkerProcessEnv = "ROUTER_TESTS_PLAN_WORKER_PROCESS"

func TestMain(m *testing.M) {
	if os.Getenv(planWorkerProcessEnv) != "" {
		err := core.RunPlanWorker(context.Background(), os.Stdin, os.Stdout, zap.NewNop(), func() { os.Exit(0) })
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}
