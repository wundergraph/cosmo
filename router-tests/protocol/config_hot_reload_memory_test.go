package integration

import (
	"bytes"
	"fmt"
	"runtime"
	"runtime/pprof"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/netpoll"
)

func TestConfigHotReloadReleasesReplacedMuxes(t *testing.T) {
	// Do not run in parallel: heap and goroutine measurements are process-wide.
	if err := netpoll.Supported(); err != nil {
		t.Skipf("cannot observe mux shutdown through websocket pollers: %v", err)
	}
	pm := ConfigPollerMock{ready: make(chan struct{})}

	testenv.Run(t, &testenv.Config{
		ModifyEngineExecutionConfiguration: func(cfg *config.EngineExecutionConfiguration) {
			cfg.EnableNetPoll = true
		},
		RouterConfig: &testenv.RouterConfig{
			ConfigPollerFactory: func(cfg *nodev1.RouterConfig) configpoller.ConfigPoller {
				myff := cfg.FeatureFlagConfigs.ConfigByFeatureFlagName["myff"]
				cfg.FeatureFlagConfigs.ConfigByFeatureFlagName["myff2"] = &nodev1.FeatureFlagRouterExecutionConfig{
					EngineConfig: myff.EngineConfig,
					Version:      "myff2-initial",
					Subgraphs:    myff.Subgraphs,
				}
				pm.initConfig = cfg
				return &pm
			},
		},
	}, func(t *testing.T, _ *testenv.Environment) {
		select {
		case <-pm.ready:
		case <-time.After(10 * time.Second):
			t.Fatal("config poller did not subscribe")
		}

		reload := func(i int) {
			// Alternate flags so every reload reuses a mux built by the previous
			// server, while keeping the base mux unchanged throughout.
			flag := []string{"myff", "myff2"}[i%2]
			pm.initConfig.FeatureFlagConfigs.ConfigByFeatureFlagName[flag].Version = fmt.Sprintf("%s-%d", flag, i)
			require.NoError(t, pm.updateConfig(&routerconfig.Response{
				Config:  pm.initConfig,
				Changes: &routerconfig.Changes{ChangedConfigs: map[string]struct{}{flag: {}}},
			}))
		}

		heapAfterGC := func(reloads int) uint64 {
			// Old pollers exit asynchronously after mux cancellation. Wait until
			// only the base mux and the two current feature-flag muxes are running.
			require.Eventually(t, func() bool {
				var goroutines bytes.Buffer
				if err := pprof.Lookup("goroutine").WriteTo(&goroutines, 2); err != nil {
					return false
				}
				return strings.Count(goroutines.String(), ".(*WebsocketHandler).runPoller(") == 3
			}, 10*time.Second, 100*time.Millisecond, "old mux pollers did not stop")

			// Drain pools and finalizers before measuring live allocations.
			for range 6 {
				runtime.GC()
			}
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			t.Logf("after %d reloads: HeapAlloc=%.1f MiB, websocket pollers=3", reloads, float64(m.HeapAlloc)/(1<<20))
			return m.HeapAlloc
		}

		for i := range 10 {
			reload(i)
		}
		start := heapAfterGC(10)
		for i := 10; i < 70; i++ {
			reload(i)
		}
		growth := int64(heapAfterGC(70)) - int64(start)
		// Leave room for runtime/test-environment noise; retaining the replaced
		// muxes grows the heap by approximately 540 MiB with this schema.
		require.Less(t, growth, int64(100<<20), "heap grew %.1f MiB over 60 reloads", float64(growth)/(1<<20))
	})
}
