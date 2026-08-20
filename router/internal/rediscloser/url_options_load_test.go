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

	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

// These tests need a real Redis: miniredis serves every command from one goroutine, so it cannot
// show pool contention, connection churn, or round-trip cost. Point them at a Redis with
// TEST_REDIS_URL; they skip when nothing is listening, so `make test` stays green without infra.
//
//	go test ./internal/rediscloser/ -run TestURLConfiguredPoolUnderSaturation -v
//	go test ./internal/rediscloser/ -run XXX -bench BenchmarkURLConfiguredPoolSize -benchtime 3s

const defaultTestRedisURL = "redis://localhost:6379"

// testRedisURL returns the base Redis URL to test against, skipping the caller when unreachable.
func testRedisURL(tb testing.TB) string {
	tb.Helper()

	raw := os.Getenv("TEST_REDIS_URL")
	if raw == "" {
		raw = defaultTestRedisURL
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

// withParams appends query parameters to the base test URL.
func withParams(tb testing.TB, base, params string) string {
	tb.Helper()

	sep := "?"
	if parsed, err := url.Parse(base); err == nil && parsed.RawQuery != "" {
		sep = "&"
	}
	return base + sep + params
}

// TestURLConfiguredPoolUnderSaturation drives far more concurrent commands than the pool has
// connections, with the pool sized purely from the URL query string. It asserts the parameters
// really govern the pool at runtime and that saturation queues commands instead of failing them.
func TestURLConfiguredPoolUnderSaturation(t *testing.T) {
	redisURL := testRedisURL(t)

	const (
		poolSize          = 4
		goroutines        = 64
		commandsPerWorker = 200
	)

	client, err := NewRedisCloser(&RedisCloserOptions{
		Logger: zap.NewNop(),
		// pool_timeout is generous for a localhost round trip: a timeout here would mean commands
		// are being dropped rather than queued.
		URLs: []string{withParams(t, redisURL, fmt.Sprintf("pool_size=%d&pool_timeout=10s", poolSize))},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	keyPrefix := fmt.Sprintf("cosmo_pool_saturation_%d:", time.Now().UnixNano())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		for i := range goroutines {
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
	for worker := range goroutines {
		wg.Add(1)
		go func() {
			defer wg.Done()

			key := fmt.Sprintf("%s%d", keyPrefix, worker)
			for i := range commandsPerWorker {
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
		}()
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

	// The URL said pool_size=4, so exceeding it would mean the parameter never reached the pool.
	require.LessOrEqual(t, int(maxObserved.Load()), poolSize, "pool_size from the URL must cap the pool")

	// A miss ratio anywhere near 1 would mean the pool reconnects per command.
	require.Greater(t, stats.Hits, uint32(totalCommands/2),
		"most connection checkouts should reuse a pooled connection")
	require.LessOrEqual(t, int(stats.Misses), poolSize*4,
		"the pool should not churn connections while it is continuously busy")
}

// TestURLConfiguredMaxActiveConnsFailsFast documents an asymmetry worth knowing before reaching for
// max_active_conns. pool_size is a turnstile that makes commands wait up to pool_timeout, but
// max_active_conns is checked when a connection is needed and returns "connection pool exhausted"
// immediately, so setting it below pool_size makes the excess commands fail rather than queue.
func TestURLConfiguredMaxActiveConnsFailsFast(t *testing.T) {
	redisURL := testRedisURL(t)

	client, err := NewRedisCloser(&RedisCloserOptions{
		Logger: zap.NewNop(),
		URLs:   []string{withParams(t, redisURL, "pool_size=32&max_active_conns=2&pool_timeout=10s")},
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = client.Close() })

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var exhausted atomic.Int64
	var wg sync.WaitGroup
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 50 {
				if err := client.Ping(ctx).Err(); err != nil {
					require.ErrorContains(t, err, "connection pool exhausted")
					exhausted.Add(1)
				}
			}
		}()
	}
	wg.Wait()

	require.Positive(t, exhausted.Load(),
		"max_active_conns below pool_size is expected to reject commands rather than queue them")
}

// BenchmarkURLConfiguredPoolSize measures GET throughput across pool sizes set in the URL, with
// many more goroutines than connections. It backs the sizing guidance in the docs.
func BenchmarkURLConfiguredPoolSize(b *testing.B) {
	redisURL := testRedisURL(b)

	// An empty params string leaves the go-redis default of 10 * GOMAXPROCS.
	for _, poolSize := range []int{1, 4, 16, 0, 128} {
		name := fmt.Sprintf("pool_size=%d", poolSize)
		params := fmt.Sprintf("pool_size=%d&pool_timeout=30s", poolSize)
		if poolSize == 0 {
			name = "pool_size=default"
			params = "pool_timeout=30s"
		}

		b.Run(name, func(b *testing.B) {
			client, err := NewRedisCloser(&RedisCloserOptions{
				Logger: zap.NewNop(),
				URLs:   []string{withParams(b, redisURL, params)},
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
