package module_test

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	ratelimiter "github.com/wundergraph/cosmo/router-tests/modules/custom-rate-limiter"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

type rlConfigPoller struct {
	initConfig   *nodev1.RouterConfig
	updateConfig func(response *routerconfig.Response) error
	ready        chan struct{}
}

func (c *rlConfigPoller) Subscribe(_ context.Context, h func(*routerconfig.Response) error) {
	c.updateConfig = h
	close(c.ready)
}

func (c *rlConfigPoller) GetRouterConfig(_ context.Context) (*routerconfig.Response, error) {
	return &routerconfig.Response{Config: c.initConfig}, nil
}

func (c *rlConfigPoller) Stop(_ context.Context) error { return nil }

func rlRequest(t *testing.T, xEnv *testenv.Environment, client string) int {
	t.Helper()
	res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
		Query:  `{ employees { id } }`,
		Header: http.Header{"X-Client-ID": []string{client}},
	})
	require.NoError(t, err)
	return res.Response.StatusCode
}

func rlModuleOptions(modCfg map[string]any) []core.Option {
	return []core.Option{
		core.WithModulesConfig(map[string]any{ratelimiter.ModuleID: modCfg}),
		core.WithCustomModules(&ratelimiter.RateLimiter{}),
	}
}

var statsKeySeq atomic.Int64

func uniqueStatsKey(t *testing.T) string {
	return fmt.Sprintf("%s#%d", t.Name(), statsKeySeq.Add(1))
}

func writeLimits(t *testing.T, path, body string, mtime time.Time) {
	t.Helper()
	require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
	require.NoError(t, os.Chtimes(path, mtime, mtime))
}

func TestCustomRateLimiterHotReload(t *testing.T) {
	t.Parallel()

	t.Run("limits file is hot reloaded by the module without restarting the router", func(t *testing.T) {
		t.Parallel()

		limitsPath := filepath.Join(t.TempDir(), "limits.json")
		writeLimits(t, limitsPath, `{"limit":2}`, time.Now().Add(-time.Hour))
		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: rlModuleOptions(map[string]any{
				"window":        "1h",
				"limits_file":   limitsPath,
				"poll_interval": "20ms",
				"stats_key":     statsKey,
			}),
			LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Equal(t, 200, rlRequest(t, xEnv, "a"))
			require.Equal(t, 200, rlRequest(t, xEnv, "a"))
			require.Equal(t, 429, rlRequest(t, xEnv, "a"))

			// Raise the limit; the counter for "a" (2 used) is kept.
			writeLimits(t, limitsPath, `{"limit":3}`, time.Now())
			require.Eventually(t, func() bool { return stats.FileReload.Load() == 2 }, 5*time.Second, 10*time.Millisecond)

			require.Equal(t, 200, rlRequest(t, xEnv, "a"))
			require.Equal(t, 429, rlRequest(t, xEnv, "a"))

			// A broken file keeps the last good limit.
			writeLimits(t, limitsPath, `{not json`, time.Now().Add(time.Second))
			require.Eventually(t, func() bool {
				return xEnv.Observer().FilterMessage("failed to reload rate limits, keeping previous").Len() > 0
			}, 5*time.Second, 10*time.Millisecond)
			require.Equal(t, 429, rlRequest(t, xEnv, "a"))
			require.Equal(t, 200, rlRequest(t, xEnv, "b"))

			require.Equal(t, int32(1), stats.Provisions.Load())

			xEnv.Shutdown()
			require.Equal(t, int32(1), stats.Cleanups.Load(), "Cleanup must stop the watcher on shutdown")
		})
	})

	t.Run("execution config hot reload keeps the module instance and its counters", func(t *testing.T) {
		t.Parallel()

		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)
		pm := &rlConfigPoller{ready: make(chan struct{})}

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: append(rlModuleOptions(map[string]any{
				"limit":     2,
				"window":    "1h",
				"stats_key": statsKey,
			}), core.WithConfigVersionHeader(true)),
			RouterConfig: &testenv.RouterConfig{
				ConfigPollerFactory: func(config *nodev1.RouterConfig) configpoller.ConfigPoller {
					pm.initConfig = config
					return pm
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Equal(t, 200, rlRequest(t, xEnv, "a"))

			<-pm.ready
			pm.initConfig.Version = "updated"
			require.NoError(t, pm.updateConfig(&routerconfig.Response{Config: pm.initConfig}))

			res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
				Query:  `{ employees { id } }`,
				Header: http.Header{"X-Client-ID": []string{"a"}},
			})
			require.NoError(t, err)
			require.Equal(t, 200, res.Response.StatusCode)
			require.Equal(t, "updated", res.Response.Header.Get("X-Router-Config-Version"))

			// Third request for "a" is limited: the count survived the schema swap.
			require.Equal(t, 429, rlRequest(t, xEnv, "a"))
			require.Equal(t, int32(1), stats.Provisions.Load())
			require.Equal(t, int32(0), stats.Cleanups.Load())
		})
	})

	t.Run("router config reload re-provisions the module with the new config and resets counters", func(t *testing.T) {
		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)
		cfg := &testenv.Config{
			NoRetryClient: true,
			RouterOptions: rlModuleOptions(map[string]any{"limit": 1, "window": "1h", "stats_key": statsKey}),
		}

		xEnv, err := testenv.CreateTestSupervisorEnv(t, cfg)
		require.NoError(t, err)

		stopped := make(chan struct{})
		go func() {
			_ = xEnv.RouterSupervisor.Start()
			close(stopped)
		}()
		t.Cleanup(func() {
			xEnv.RouterSupervisor.Stop()
			xEnv.Shutdown()
			<-stopped
		})

		require.NoError(t, xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 2000, 30))
		require.Equal(t, 200, rlRequest(t, xEnv, "a"))
		require.Equal(t, 429, rlRequest(t, xEnv, "a"))

		// Equivalent of editing `modules.customRateLimiter.limit` in config.yaml
		// and sending SIGHUP / letting watch_config fire.
		cfg.RouterOptions = rlModuleOptions(map[string]any{"limit": 3, "window": "1h", "stats_key": statsKey})
		xEnv.RouterSupervisor.Reload()

		require.Eventually(t, func() bool { return stats.Provisions.Load() == 2 }, 10*time.Second, 10*time.Millisecond)
		require.NoError(t, xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 2000, 30))
		require.Equal(t, int32(1), stats.Cleanups.Load(), "old instance must be cleaned up")

		// New instance: limit 3 and counters started from zero.
		require.Equal(t, 200, rlRequest(t, xEnv, "a"))
		require.Equal(t, 200, rlRequest(t, xEnv, "a"))
		require.Equal(t, 200, rlRequest(t, xEnv, "a"))
		require.Equal(t, 429, rlRequest(t, xEnv, "a"))
	})
}
