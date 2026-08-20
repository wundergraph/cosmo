package integration

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// TestRateLimitRedisURLOptions verifies that connection pool settings placed in the Redis
// connection URL take effect end to end. The router has no dedicated pool configuration: go-redis
// parses these parameters itself, so this checks a user really can tune the pool from the URL they
// put in the router config, on the rate limiter path where Redis is hit on every request.
//
// Requires the dev Redis (`make infra-up`).
func TestRateLimitRedisURLOptions(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Parallel()

	const (
		concurrent = 48
		perWorker  = 15
	)

	key := uuid.New().String()

	t.Cleanup(func() {
		client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
		defer client.Close()
		// redis_rate namespaces the counter it keeps for our key.
		require.NoError(t, client.Del(context.Background(), key, "rate:"+key).Err())
	})

	testenv.Run(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithRateLimitConfig(&config.RateLimitConfiguration{
				Enabled:  true,
				Strategy: "simple",
				SimpleStrategy: config.RateLimitSimpleStrategy{
					// High enough that nothing is rejected: this is about the connection, not the
					// rate limiting decision.
					Rate:                    100000,
					Burst:                   100000,
					Period:                  time.Minute,
					RejectExceedingRequests: false,
				},
				// Exposes the rate limit key in the response extension for the assertion below.
				Debug: true,
				Storage: config.RedisConfiguration{
					// A pool far smaller than the request concurrency, configured entirely through
					// the URL. Requests must share connections rather than stall or fail.
					URLs:      []string{"redis://localhost:6379?pool_size=4&min_idle_conns=1&pool_timeout=10s&conn_max_idle_time=1m"},
					KeyPrefix: key,
				},
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {
		var failures atomic.Int64
		var succeeded atomic.Int64

		start := time.Now()

		var wg sync.WaitGroup
		for range concurrent {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for range perWorker {
					res, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{
						Query:     `query ($n:Int!) { employee(id:$n) { id details { forename surname } } }`,
						Variables: json.RawMessage(`{"n":1}`),
					})
					if err != nil || res.Response.StatusCode != 200 {
						failures.Add(1)
						return
					}
					succeeded.Add(1)
				}
			}()
		}
		wg.Wait()

		elapsed := time.Since(start)
		total := concurrent * perWorker

		t.Logf("%d requests through a rate-limited router in %s (%.0f req/s) with pool_size=4 in the URL and %d concurrent clients",
			total, elapsed.Round(time.Millisecond), float64(total)/elapsed.Seconds(), concurrent)

		require.Zero(t, failures.Load(), "no request may fail because of Redis pool contention")
		require.EqualValues(t, total, succeeded.Load())

		// Debug echoes the rate limit key, and the limiter's state for it lives in Redis. Together
		// they show the requests reached Redis: one that never did would leave no key behind.
		res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
			Query:     `query ($n:Int!) { employee(id:$n) { id } }`,
			Variables: json.RawMessage(`{"n":1}`),
		})

		var body struct {
			Extensions struct {
				RateLimit struct {
					Key string `json:"key"`
				} `json:"rateLimit"`
			} `json:"extensions"`
		}
		require.NoError(t, json.Unmarshal([]byte(res.Body), &body))
		require.Equal(t, key, body.Extensions.RateLimit.Key)

		client := redis.NewClient(&redis.Options{Addr: "localhost:6379", Password: "test"})
		defer client.Close()
		keys, err := client.Keys(context.Background(), "*"+key+"*").Result()
		require.NoError(t, err)
		require.NotEmpty(t, keys, "the rate limiter must have written its state to Redis")
	})
}

// TestRateLimitRedisURLRejectsUnknownOption checks that a mistyped pool parameter stops the router
// from starting rather than being silently ignored, so a typo cannot go unnoticed in production.
func TestRateLimitRedisURLRejectsUnknownOption(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Parallel()

	err := testenv.RunWithError(t, &testenv.Config{
		RouterOptions: []core.Option{
			core.WithRateLimitConfig(&config.RateLimitConfiguration{
				Enabled:  true,
				Strategy: "simple",
				SimpleStrategy: config.RateLimitSimpleStrategy{
					Rate:   10,
					Burst:  10,
					Period: time.Second,
				},
				Storage: config.RedisConfiguration{
					URLs:      []string{"redis://localhost:6379?pool_sizee=4"},
					KeyPrefix: uuid.New().String(),
				},
			}),
		},
	}, func(t *testing.T, xEnv *testenv.Environment) {})

	require.Error(t, err)
	require.ErrorContains(t, err, "unexpected option: pool_sizee")
}
