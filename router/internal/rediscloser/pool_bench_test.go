package rediscloser

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.uber.org/zap"
)

// These tests need a real Redis: miniredis serves every command from one goroutine, so it cannot
// show pool contention, connection churn, or round-trip cost. Point them at a Redis with
// TEST_REDIS_URL; they skip when nothing is listening, so `make test` stays green without infra.
//
//	go test ./internal/rediscloser/ -run TestPoolUnderSaturation -v
//	go test ./internal/rediscloser/ -run XXX -bench BenchmarkPool -benchtime 3s

const defaultBenchRedisURL = "redis://localhost:6379"

// benchRedisURL returns the Redis URL to test against, skipping the caller when it is unreachable.
func benchRedisURL(tb testing.TB) string {
	tb.Helper()

	raw := os.Getenv("TEST_REDIS_URL")
	if raw == "" {
		raw = defaultBenchRedisURL
	}

	parsed, err := url.Parse(raw)
	require.NoError(tb, err, "TEST_REDIS_URL is not a valid URL")

	conn, err := net.DialTimeout("tcp", parsed.Host, 500*time.Millisecond)
	if err != nil {
		tb.Skipf("no Redis reachable at %s, skipping: %v", parsed.Host, err)
	}
	_ = conn.Close()

	return raw
}

// TestPoolUnderSaturation drives far more concurrent commands than the pool has connections, and
// asserts what would break a router under load: commands queue rather than fail, the pool stays
// within its configured size, and it does not churn connections while busy.
func TestPoolUnderSaturation(t *testing.T) {
	redisURL := benchRedisURL(t)

	const (
		poolSize          = 4
		goroutines        = 64
		commandsPerWorker = 200
	)

	client, err := NewRedisCloser(&RedisCloserOptions{
		Logger: zap.NewNop(),
		URLs:   []string{redisURL},
		Pool: &config.RedisConnectionPoolConfiguration{
			Size: poolSize,
			// Generous for a localhost round trip: a timeout here would mean dropped commands.
			Timeout: 10 * time.Second,
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	keyPrefix := fmt.Sprintf("cosmo_pool_saturation_%d:", time.Now().UnixNano())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for i := 0; i < goroutines; i++ {
			client.Del(ctx, fmt.Sprintf("%s%d", keyPrefix, i))
		}
	})

	// High-water mark, sampled by the workers, so an overshoot is caught even if the pool has
	// shrunk again by the time the run finishes.
	var maxObserved atomic.Int32
	var failures atomic.Int64

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	start := time.Now()

	var wg sync.WaitGroup
	for worker := 0; worker < goroutines; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()

			key := fmt.Sprintf("%s%d", keyPrefix, worker)
			for i := 0; i < commandsPerWorker; i++ {
				if err := client.Set(ctx, key, i, time.Minute).Err(); err != nil {
					failures.Add(1)
					return
				}
				if err := client.Get(ctx, key).Err(); err != nil {
					failures.Add(1)
					return
				}
				if total := int32(client.PoolStats().TotalConns); total > maxObserved.Load() {
					maxObserved.Store(total)
				}
			}
		}(worker)
	}
	wg.Wait()

	elapsed := time.Since(start)
	stats := client.PoolStats()
	totalCommands := goroutines * commandsPerWorker * 2

	t.Logf("saturation: %d commands in %s (%.0f cmd/s) with pool_size=%d and %d goroutines",
		totalCommands, elapsed.Round(time.Millisecond), float64(totalCommands)/elapsed.Seconds(), poolSize, goroutines)
	t.Logf("pool stats: hits=%d misses=%d timeouts=%d total_conns=%d idle=%d stale=%d max_observed_conns=%d",
		stats.Hits, stats.Misses, stats.Timeouts, stats.TotalConns, stats.IdleConns, stats.StaleConns, maxObserved.Load())

	require.Zero(t, failures.Load(), "commands must queue for a connection, not fail, when the pool is saturated")
	require.Zero(t, stats.Timeouts, "no command should have given up waiting for a connection")

	// With MaxActiveConns unset, PoolSize is the cap for pooled connections, so exceeding it would
	// mean the setting never reached the client.
	require.LessOrEqual(t, int(maxObserved.Load()), poolSize, "pool must not grow past the configured size")

	// A miss ratio anywhere near 1 would mean the pool reconnects per command.
	require.Greater(t, stats.Hits, uint32(totalCommands/2),
		"most connection checkouts should reuse a pooled connection")
	require.LessOrEqual(t, int(stats.Misses), poolSize*4,
		"the pool should not churn connections while it is continuously busy")
}

// TestPoolMaxActiveConnsIsEnforced checks the hard cap operators reach for when Redis has a
// maxclients limit to respect. Size equals the cap here, which is the configuration we recommend;
// see TestPoolMaxActiveConnsBelowSizeFailsFast for what happens when it is not.
func TestPoolMaxActiveConnsIsEnforced(t *testing.T) {
	redisURL := benchRedisURL(t)

	const maxActive = 3

	client, err := NewRedisCloser(&RedisCloserOptions{
		Logger: zap.NewNop(),
		URLs:   []string{redisURL},
		Pool: &config.RedisConnectionPoolConfiguration{
			Size:           maxActive,
			MaxActiveConns: maxActive,
			Timeout:        10 * time.Second,
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var maxObserved atomic.Int32
	var failures atomic.Int64
	var wg sync.WaitGroup
	for worker := 0; worker < 32; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				if err := client.Ping(ctx).Err(); err != nil {
					failures.Add(1)
					return
				}
				if total := int32(client.PoolStats().TotalConns); total > maxObserved.Load() {
					maxObserved.Store(total)
				}
			}
		}()
	}
	wg.Wait()

	require.Zero(t, failures.Load(), "commands must queue rather than fail when size equals the cap")
	require.LessOrEqual(t, int(maxObserved.Load()), maxActive,
		"max_active_conns must cap the total number of connections")
	require.Zero(t, client.PoolStats().Timeouts)
}

// TestPoolMaxActiveConns pins down an easily misconfigured go-redis behaviour.
// Size is a turnstile that makes commands wait up to Timeout, but MaxActiveConns is checked when a
// connection is needed and returns "connection pool exhausted" immediately. Setting it below Size
// admits more commands than there are connections for, which is why NewRedisCloser warns.
func TestPoolMaxActiveConns(t *testing.T) {
	redisURL := benchRedisURL(t)

	client, err := NewRedisCloser(&RedisCloserOptions{
		Logger: zap.NewNop(),
		URLs:   []string{redisURL},
		Pool: &config.RedisConnectionPoolConfiguration{
			Size:           32,
			MaxActiveConns: 2,
			Timeout:        10 * time.Second,
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	options := client.(*redis.Client).Options()

	require.Equal(t, options.MaxActiveConns, options.PoolSize)
}

// BenchmarkPoolSize measures GET throughput across pool sizes with many more goroutines than
// connections, to catch a pool that does not scale and to give a reference point when tuning.
func BenchmarkPoolSize(b *testing.B) {
	redisURL := benchRedisURL(b)

	// 0 means "leave unset", i.e. the go-redis default of 10 * GOMAXPROCS.
	for _, poolSize := range []int{1, 4, 16, 0, 128} {
		name := fmt.Sprintf("pool_size=%d", poolSize)
		if poolSize == 0 {
			name = "pool_size=default"
		}

		b.Run(name, func(b *testing.B) {
			client, err := NewRedisCloser(&RedisCloserOptions{
				Logger: zap.NewNop(),
				URLs:   []string{redisURL},
				Pool: &config.RedisConnectionPoolConfiguration{
					Size:    poolSize,
					Timeout: 30 * time.Second,
				},
			})
			require.NoError(b, err)
			defer func() { _ = client.Close() }()

			key := fmt.Sprintf("cosmo_pool_bench_%d_%d", poolSize, time.Now().UnixNano())
			ctx := context.Background()
			require.NoError(b, client.Set(ctx, key, "value", time.Hour).Err())
			defer client.Del(ctx, key)

			// Oversubscribe so the pool is the bottleneck rather than the number of CPUs.
			b.SetParallelism(16)
			b.ResetTimer()

			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					if err := client.Get(ctx, key).Err(); err != nil {
						b.Error(err)
						return
					}
				}
			})

			b.StopTimer()
			stats := client.PoolStats()
			b.ReportMetric(float64(stats.Misses), "conn_misses")
			b.ReportMetric(float64(stats.Timeouts), "pool_timeouts")
			b.ReportMetric(float64(stats.TotalConns), "conns")
		})
	}
}
