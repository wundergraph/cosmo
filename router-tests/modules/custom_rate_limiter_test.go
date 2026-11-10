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

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap/zapcore"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/controlplane/configpoller"
	"github.com/wundergraph/cosmo/router/pkg/routerconfig"

	ratelimiter "github.com/wundergraph/cosmo/router-tests/modules/custom-rate-limiter"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
)

const rlRedisURL = "redis://localhost:6379"

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

func rlDo(t *testing.T, xEnv *testenv.Environment, client string) *http.Response {
	t.Helper()
	res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
		Query:  `{ employees { id } }`,
		Header: http.Header{"X-Client-ID": []string{client}},
	})
	require.NoError(t, err)
	return res.Response
}

func rlCustomerRequest(t *testing.T, xEnv *testenv.Environment, header, customer string) int {
	t.Helper()
	h := http.Header{}
	if customer != "" {
		h.Set(header, customer)
	}
	res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: `{ employees { id } }`, Header: h})
	require.NoError(t, err)
	return res.Response.StatusCode
}

// rlExpect sends n requests for a customer and asserts the status of each.
func rlExpect(t *testing.T, xEnv *testenv.Environment, header, customer string, statuses ...int) {
	t.Helper()
	for i, want := range statuses {
		require.Equal(t, want, rlCustomerRequest(t, xEnv, header, customer), "customer %q request %d", customer, i+1)
	}
}

func rlRequest(t *testing.T, xEnv *testenv.Environment, client string) int {
	t.Helper()
	return rlDo(t, xEnv, client).StatusCode
}

func rlModuleOptions(modCfg map[string]any) []core.Option {
	return []core.Option{
		core.WithModulesConfig(map[string]any{ratelimiter.ModuleID: modCfg}),
		core.WithCustomModules(&ratelimiter.RateLimiter{}),
	}
}

// rlModuleConfig returns a config with rate 1 per hour, so nothing refills
// during a test and only the burst decides how many requests pass.
func rlModuleConfig(prefix, statsKey string, burst int) map[string]any {
	return map[string]any{
		"redis_url":  rlRedisURL,
		"key_prefix": prefix,
		"rate":       1,
		"burst":      burst,
		"period":     "1h",
		"stats_key":  statsKey,
	}
}

var statsKeySeq atomic.Int64

func uniqueStatsKey(t *testing.T) string {
	return fmt.Sprintf("%s#%d", t.Name(), statsKeySeq.Add(1))
}

// uniqueRedisPrefix isolates a test's keys and deletes them afterwards.
func uniqueRedisPrefix(t *testing.T) string {
	prefix := "custom_rl_test:" + uuid.NewString()
	t.Cleanup(func() {
		opts, err := redis.ParseURL(rlRedisURL)
		require.NoError(t, err)
		client := redis.NewClient(opts)
		defer client.Close()
		ctx := context.Background()
		keys, err := client.Keys(ctx, prefix+":*").Result()
		require.NoError(t, err)
		if len(keys) > 0 {
			require.NoError(t, client.Del(ctx, keys...).Err())
		}
	})
	return prefix
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
		writeLimits(t, limitsPath, `{"default":{"rate":1,"burst":2,"period":"1h"}}`, time.Now().Add(-time.Hour))
		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: rlModuleOptions(map[string]any{
				"redis_url":     rlRedisURL,
				"key_prefix":    uniqueRedisPrefix(t),
				"limits_file":   limitsPath,
				"poll_interval": "20ms",
				"stats_key":     statsKey,
			}),
			LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			require.Equal(t, 200, rlRequest(t, xEnv, "a"))
			require.Equal(t, 200, rlRequest(t, xEnv, "a"))
			denied := rlDo(t, xEnv, "a")
			require.Equal(t, 429, denied.StatusCode)
			require.NotEmpty(t, denied.Header.Get("Retry-After"))

			// Raise the burst; the 2 requests already counted in Redis still count.
			writeLimits(t, limitsPath, `{"default":{"rate":1,"burst":3,"period":"1h"}}`, time.Now())
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

	t.Run("per-customer limits from the limits file are hot reloaded", func(t *testing.T) {
		t.Parallel()

		limitsPath := filepath.Join(t.TempDir(), "limits.json")
		// rate 1/h everywhere so only the burst decides how many requests pass.
		writeLimits(t, limitsPath, `{
			"header": "X-Customer-ID",
			"default": {"rate": 1, "burst": 2, "period": "1h"},
			"customers": {
				"acme":    {"rate": 1, "burst": 1, "period": "1h"},
				"globex":  {"rate": 1, "burst": 3, "period": "1h"},
				"hooli":   {"rate": 1, "burst": 1, "period": "300ms"}
			}
		}`, time.Now().Add(-time.Hour))
		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: rlModuleOptions(map[string]any{
				"redis_url":     rlRedisURL,
				"key_prefix":    uniqueRedisPrefix(t),
				"limits_file":   limitsPath,
				"poll_interval": "20ms",
				"stats_key":     statsKey,
			}),
			LogObservation: testenv.LogObservationConfig{Enabled: true, LogLevel: zapcore.InfoLevel},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			const h = "X-Customer-ID"

			rlExpect(t, xEnv, h, "acme", 200, 429)
			rlExpect(t, xEnv, h, "globex", 200, 200, 200, 429)
			// hooli has a 300ms window: denied, then allowed again once it refills.
			rlExpect(t, xEnv, h, "hooli", 200, 429)
			require.Eventually(t, func() bool {
				return rlCustomerRequest(t, xEnv, h, "hooli") == 200
			}, 5*time.Second, 50*time.Millisecond)

			// Unlisted customers get the default, each with their own budget.
			rlExpect(t, xEnv, h, "initech", 200, 200, 429)
			rlExpect(t, xEnv, h, "umbrella", 200, 200, 429)
			// No header at all also falls back to the default.
			rlExpect(t, xEnv, h, "", 200, 200, 429)
			// A customer named "anonymous" doesn't share the no-header budget.
			rlExpect(t, xEnv, h, "anonymous", 200, 200, 429)

			// Reload: acme upgraded, initech gets its own entry, a new header name,
			// and no default, so unlisted customers are no longer limited.
			writeLimits(t, limitsPath, `{
				"header": "X-Tenant",
				"customers": {
					"acme":    {"rate": 1, "burst": 3, "period": "1h"},
					"globex":  {"rate": 1, "burst": 3, "period": "1h"},
					"initech": {"rate": 1, "burst": 4, "period": "1h"}
				}
			}`, time.Now())
			require.Eventually(t, func() bool { return stats.FileReload.Load() == 2 }, 5*time.Second, 10*time.Millisecond)

			const h2 = "X-Tenant"
			// Counts already in Redis still apply: acme used 1 of its new 3.
			rlExpect(t, xEnv, h2, "acme", 200, 200, 429)
			rlExpect(t, xEnv, h2, "globex", 429)
			// initech used 2, its new burst is 4.
			rlExpect(t, xEnv, h2, "initech", 200, 200, 429)
			// umbrella was limited by the old default; with no default it is unlimited now.
			rlExpect(t, xEnv, h2, "umbrella", 200, 200, 200, 200)
			// The old header no longer identifies anyone: no default means no limit.
			rlExpect(t, xEnv, h, "globex", 200, 200)

			// Invalid policies are rejected and the previous one stays active.
			for i, bad := range []string{
				`{"customers": {"acme": {"rate": 0, "burst": 1, "period": "1h"}}}`,
				`{"customers": {"acme": {"rate": 1, "burst": 1, "period": "soon"}}}`,
				`{"custmers": {}}`,
			} {
				before := xEnv.Observer().FilterMessage("failed to reload rate limits, keeping previous").Len()
				writeLimits(t, limitsPath, bad, time.Now().Add(time.Duration(i+1)*time.Second))
				require.Eventually(t, func() bool {
					return xEnv.Observer().FilterMessage("failed to reload rate limits, keeping previous").Len() > before
				}, 5*time.Second, 10*time.Millisecond, "policy %d should be rejected", i)
				rlExpect(t, xEnv, h2, "acme", 429)
			}
			require.Equal(t, int32(2), stats.FileReload.Load())
		})
	})

	t.Run("execution config hot reload keeps the module instance", func(t *testing.T) {
		t.Parallel()

		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)
		pm := &rlConfigPoller{ready: make(chan struct{})}

		testenv.Run(t, &testenv.Config{
			NoRetryClient: true,
			RouterOptions: append(rlModuleOptions(rlModuleConfig(uniqueRedisPrefix(t), statsKey, 2)),
				core.WithConfigVersionHeader(true)),
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

			res := rlDo(t, xEnv, "a")
			require.Equal(t, 200, res.StatusCode)
			require.Equal(t, "updated", res.Header.Get("X-Router-Config-Version"))

			require.Equal(t, 429, rlRequest(t, xEnv, "a"))
			require.Equal(t, int32(1), stats.Provisions.Load())
			require.Equal(t, int32(0), stats.Cleanups.Load())
		})
	})

	t.Run("router config reload re-provisions the module with the new config and keeps counters in redis", func(t *testing.T) {
		statsKey := uniqueStatsKey(t)
		stats := ratelimiter.StatsFor(statsKey)
		prefix := uniqueRedisPrefix(t)
		cfg := &testenv.Config{
			NoRetryClient: true,
			RouterOptions: rlModuleOptions(rlModuleConfig(prefix, statsKey, 1)),
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

		// Equivalent of editing `modules.customRateLimiter.burst` in config.yaml
		// and sending SIGHUP / letting watch_config fire.
		cfg.RouterOptions = rlModuleOptions(rlModuleConfig(prefix, statsKey, 3))
		xEnv.RouterSupervisor.Reload()

		require.Eventually(t, func() bool { return stats.Provisions.Load() == 2 }, 10*time.Second, 10*time.Millisecond)
		require.NoError(t, xEnv.WaitForServer(context.Background(), xEnv.RouterURL+"/health/ready", 2000, 30))
		require.Equal(t, int32(1), stats.Cleanups.Load(), "old instance must be cleaned up")

		// New instance has burst 3, but the request counted before the reload
		// is still in Redis: only 2 more pass.
		require.Equal(t, 200, rlRequest(t, xEnv, "a"))
		require.Equal(t, 200, rlRequest(t, xEnv, "a"))
		require.Equal(t, 429, rlRequest(t, xEnv, "a"))
	})

	t.Run("router fails to start when redis is unreachable", func(t *testing.T) {
		t.Parallel()

		cfg := rlModuleConfig("unused", uniqueStatsKey(t), 1)
		cfg["redis_url"] = "redis://localhost:1"

		testenv.FailsOnStartup(t, &testenv.Config{
			RouterOptions: rlModuleOptions(cfg),
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "failed to connect to redis")
		})
	})
}
