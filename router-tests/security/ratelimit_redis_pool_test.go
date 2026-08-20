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

// TestRateLimitRedisConnectionPool drives concurrent GraphQL requests through a rate-limited router,
// putting Redis on the critical path of every request. The pool tests in router/internal/rediscloser
// cover the client in isolation; this one checks the router does not fail or stall requests when many
// contend for a small pool. Requires the dev Redis (`make infra-up`).
func TestRateLimitRedisConnectionPool(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping test in short mode.")
	}

	t.Parallel()

	const (
		poolSize   = 4
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
					URLs:      []string{"redis://localhost:6379"},
					KeyPrefix: key,
					Pool: config.RedisConnectionPoolConfiguration{
						// Far smaller than the request concurrency, so requests must share
						// connections. Without a working pool this is where they would stall.
						Size:         poolSize,
						MinIdleConns: 1,
						Timeout:      10 * time.Second,
					},
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

		t.Logf("%d requests through a rate-limited router in %s (%.0f req/s) with redis pool_size=%d and %d concurrent clients",
			total, elapsed.Round(time.Millisecond), float64(total)/elapsed.Seconds(), poolSize, concurrent)

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
