package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// A dangling entry is live past its write lease but missing from a tag set,
// so invalidating that tag can't reach it.
func TestResponseCacheNoDanglingEntries(t *testing.T) {
	t.Parallel()

	const (
		moodQuery = `query { employees { id currentMood } }`
		// Mirror the redis adapter's writeLease and tagIndexPruneGrace.
		writeLease = 10 * time.Second
		pruneGrace = 5 * time.Minute
	)
	sharedTags := []string{"subgraph:mood", "type:mood:Employee", "declared:mood:moods"}

	moodEnv := func(cfg *config.ResponseCacheConfiguration) *testenv.Config {
		return &testenv.Config{
			RouterOptions: []core.Option{responseCacheStorageProviders(), core.WithResponseCache(cfg)},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: fixedResponseMiddleware("public, max-age=60", taggedMoodBatch)},
			},
		}
	}

	t.Run("every extended entry is listed by its tags until it expires", func(t *testing.T) {
		t.Parallel()
		cfg, _ := makeCacheAsConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			client := newResponseCacheRedisClient(t)
			ctx := context.Background()
			now, err := client.Time(ctx).Result()
			require.NoError(t, err)

			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			require.Len(t, entries, 10)
			for _, entry := range entries {
				entryTTL, err := client.PTTL(ctx, cfg.KeyPrefix+responseCacheEntryNamespace+entry).Result()
				require.NoError(t, err)
				require.Greater(t, entryTTL, writeLease, "%s is extended past its lease", entry)

				for _, tag := range sharedTags {
					tagKey := cfg.KeyPrefix + responseCacheTagNamespace + tag
					score, err := client.ZScore(ctx, tagKey, entry).Result()
					require.NoError(t, err, "%s is listed by %s", entry, tag)
					// Scored by redis' clock, at or after the entry's expiry.
					require.GreaterOrEqual(t, int64(score), now.Add(entryTTL).UnixMilli()-1, "%s outlives its member in %s", entry, tag)

					tagTTL, err := client.PTTL(ctx, tagKey).Result()
					require.NoError(t, err)
					require.Greater(t, tagTTL, entryTTL, "%s outlives tag set %s", entry, tag)
				}
			}
		})
	})

	t.Run("a write prunes by redis' clock, keeping members inside the grace", func(t *testing.T) {
		t.Parallel()
		cfg, _ := makeCacheAsConfig(t)

		client := newResponseCacheRedisClient(t)
		ctx := context.Background()
		now, err := client.Time(ctx).Result()
		require.NoError(t, err)

		tagKey := cfg.KeyPrefix + responseCacheTagNamespace + "declared:mood:moods"
		require.NoError(t, client.ZAdd(ctx, tagKey,
			redis.Z{Member: "dead", Score: float64(now.Add(-pruneGrace - 10*time.Second).UnixMilli())},
			redis.Z{Member: "recent", Score: float64(now.Add(-pruneGrace + 30*time.Second).UnixMilli())},
		).Err())

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: moodQuery})

			members, err := client.ZRange(ctx, tagKey, 0, -1).Result()
			require.NoError(t, err)
			require.NotContains(t, members, "dead", "past the grace")
			require.Contains(t, members, "recent", "inside the grace")
			require.Len(t, members, 11, "the ten written plus recent")
		})
	})

	t.Run("invalidations racing writes leave nothing past its lease", func(t *testing.T) {
		t.Parallel()
		cfg, addr := makeCacheAsConfig(t)

		testenv.Run(t, moodEnv(cfg), func(t *testing.T, xEnv *testenv.Environment) {
			var wg sync.WaitGroup
			var failure atomic.Value
			for range 4 {
				wg.Go(func() {
					for range 100 {
						if _, err := xEnv.MakeGraphQLRequest(testenv.GraphQLRequest{Query: moodQuery}); err != nil {
							failure.CompareAndSwap(nil, err)
						}
					}
				})
			}
			for range 2 {
				wg.Go(func() {
					for range 100 {
						if err := postInvalidation(addr, `[{"kind":"subgraph","subgraph":"mood"}]`); err != nil {
							failure.CompareAndSwap(nil, err)
						}
					}
				})
			}
			wg.Wait()
			require.Nil(t, failure.Load())
			require.Greater(t, xEnv.SubgraphRequestCount.Mood.Load(), int64(1), "invalidations forced fresh writes")

			// Anything a final invalidation can't reach may only be on its lease.
			status, _ := invalidateCacheKey(t, addr, responseCacheSharedKey, `[{"kind":"subgraph","subgraph":"mood"}]`)
			require.Equal(t, http.StatusAccepted, status)

			client := newResponseCacheRedisClient(t)
			entries, _ := responseCacheStored(t, cfg.KeyPrefix)
			for _, entry := range entries {
				ttl, err := client.PTTL(context.Background(), cfg.KeyPrefix+responseCacheEntryNamespace+entry).Result()
				require.NoError(t, err)
				require.LessOrEqual(t, ttl, writeLease, "%s survived invalidating its subgraph with %s left", entry, ttl)
			}
		})
	})
}

func newResponseCacheRedisClient(t *testing.T) *redis.Client {
	t.Helper()
	client := redis.NewClient(&redis.Options{Addr: responseCacheRedisAddr})
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// postInvalidation is invalidateCacheKey for goroutines: it returns errors
// instead of failing the test.
func postInvalidation(addr, body string) error {
	req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/invalidation", strings.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", responseCacheSharedKey)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusAccepted {
		return fmt.Errorf("invalidation answered %d", res.StatusCode)
	}
	return nil
}
