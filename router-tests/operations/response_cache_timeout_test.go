package integration

import (
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// redisProxy fronts the test redis: stall hangs it, shut refuses new conns.
type redisProxy struct {
	ln      net.Listener
	shut    atomic.Bool
	reads   atomic.Int64 // reads with data, either direction
	stalled chan struct{}
	once    sync.Once
	done    chan struct{}
}

func newRedisProxy(t *testing.T) *redisProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	p := &redisProxy{ln: ln, stalled: make(chan struct{}), done: make(chan struct{})}
	t.Cleanup(func() {
		close(p.done)
		_ = ln.Close()
	})
	go func() {
		for {
			client, err := ln.Accept()
			if err != nil {
				return
			}
			if p.shut.Load() {
				_ = client.Close()
				continue
			}
			server, err := net.Dial("tcp", responseCacheRedisAddr)
			if err != nil {
				_ = client.Close()
				continue
			}
			go p.pipe(client, server)
			go p.pipe(server, client)
		}
	}()
	return p
}

func (p *redisProxy) url() string { return "redis://" + p.ln.Addr().String() }

func (p *redisProxy) stall() { p.once.Do(func() { close(p.stalled) }) }

func (p *redisProxy) pipe(dst, src net.Conn) {
	defer func() { _ = dst.Close() }()
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 {
			p.reads.Add(1)
		}
		select {
		case <-p.stalled:
			<-p.done // swallow: the peer waits for a reply that never comes
			return
		default:
		}
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func TestResponseCacheRedisTimeouts(t *testing.T) {
	t.Parallel()

	t.Run("a stalled redis degrades to the subgraph within the storage timeouts", func(t *testing.T) {
		t.Parallel()

		proxy := newRedisProxy(t)
		cfg := responseCacheConfig(t, time.Minute)
		cfg.Storage.LookupTimeout = 100 * time.Millisecond
		cfg.Storage.WriteTimeout = 100 * time.Millisecond

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					Redis: []config.RedisStorageProvider{{URLs: []string{proxy.url()}, ID: responseCacheRedisProviderID}},
				}),
				core.WithResponseCache(cfg),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`}
			warm := xEnv.MakeGraphQLRequestOK(query)
			xEnv.MakeGraphQLRequestOK(query)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "warm before stalling")

			proxy.stall()

			start := time.Now()
			res := xEnv.MakeGraphQLRequestOK(query)
			elapsed := time.Since(start)

			require.Equal(t, warm.Body, res.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "the lookup must give up and fetch")
			// lookup + write bounds plus the fetch; the go-redis default is 3s per read.
			require.Less(t, elapsed, 2500*time.Millisecond)
		})
	})
}

func TestResponseCacheRedisDownAtStartup(t *testing.T) {
	t.Parallel()

	// A port nothing listens on.
	downURL := func(t *testing.T) string {
		return fmt.Sprintf("redis://127.0.0.1:%d", freeport.GetOne(t))
	}

	t.Run("the router starts and serves from the subgraphs", func(t *testing.T) {
		t.Parallel()

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					Redis: []config.RedisStorageProvider{{URLs: []string{downURL(t)}, ID: responseCacheRedisProviderID}},
				}),
				core.WithResponseCache(responseCacheConfig(t, time.Minute)),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`}
			first := xEnv.MakeGraphQLRequestOK(query)
			second := xEnv.MakeGraphQLRequestOK(query)
			require.Equal(t, first.Body, second.Body)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("a redis that never answers does not hold startup", func(t *testing.T) {
		t.Parallel()

		proxy := newRedisProxy(t)
		proxy.stall()

		start := time.Now()
		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					Redis: []config.RedisStorageProvider{{URLs: []string{proxy.url()}, ID: responseCacheRedisProviderID}},
				}),
				core.WithResponseCache(responseCacheConfig(t, time.Minute)),
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			// 2s ping bound plus startup; unbounded takes over 6s.
			require.Less(t, time.Since(start), 5*time.Second)
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{Query: `query { employees { id } }`})
		})
	})
}

func TestResponseCacheRedisCircuitBreaker(t *testing.T) {
	t.Parallel()

	t.Run("a stalled redis is bypassed once the breaker trips", func(t *testing.T) {
		t.Parallel()

		proxy := newRedisProxy(t)
		cfg := responseCacheConfig(t, time.Minute)
		cfg.Storage.LookupTimeout = 300 * time.Millisecond
		cfg.Storage.WriteTimeout = 300 * time.Millisecond
		cfg.Storage.CircuitBreaker = config.ResponseCacheCircuitBreakerConfig{
			Enabled:          true,
			FailureThreshold: 1,
			// Stays down for the test.
			ProbeInterval: time.Hour,
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					Redis: []config.RedisStorageProvider{{URLs: []string{proxy.url()}, ID: responseCacheRedisProviderID}},
				}),
				core.WithResponseCache(cfg),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`}
			warm := xEnv.MakeGraphQLRequestOK(query)
			xEnv.MakeGraphQLRequestOK(query)
			require.EqualValues(t, 1, xEnv.SubgraphRequestCount.Mood.Load(), "warm before stalling")

			proxy.stall()

			// Waits out the lookup timeout, which trips the breaker.
			start := time.Now()
			xEnv.MakeGraphQLRequestOK(query)
			require.GreaterOrEqual(t, time.Since(start), 300*time.Millisecond)

			reads := proxy.reads.Load()
			res := xEnv.MakeGraphQLRequestOK(query)
			require.Equal(t, reads, proxy.reads.Load(), "a down redis must not be sent to")
			require.Equal(t, warm.Body, res.Body)
			require.EqualValues(t, 3, xEnv.SubgraphRequestCount.Mood.Load())
		})
	})

	t.Run("a redis down at startup is used once it answers", func(t *testing.T) {
		t.Parallel()

		proxy := newRedisProxy(t)
		proxy.shut.Store(true)
		cfg := responseCacheConfig(t, time.Minute)
		cfg.Storage.CircuitBreaker = config.ResponseCacheCircuitBreakerConfig{
			Enabled:          true,
			FailureThreshold: 5,
			ProbeInterval:    20 * time.Millisecond,
		}

		testenv.Run(t, &testenv.Config{
			RouterOptions: []core.Option{
				core.WithStorageProviders(config.StorageProviders{
					Redis: []config.RedisStorageProvider{{URLs: []string{proxy.url()}, ID: responseCacheRedisProviderID}},
				}),
				core.WithResponseCache(cfg),
			},
			Subgraphs: testenv.SubgraphsConfig{
				Mood: testenv.SubgraphConfig{Middleware: cacheControlMiddleware("max-age=60")},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			query := testenv.GraphQLRequest{Query: `query { employees { id currentMood } }`}
			xEnv.MakeGraphQLRequestOK(query)
			xEnv.MakeGraphQLRequestOK(query)
			require.EqualValues(t, 2, xEnv.SubgraphRequestCount.Mood.Load(), "no cache while down")

			proxy.shut.Store(false)

			// Back once a request after a write is answered from the cache.
			require.Eventually(t, func() bool {
				xEnv.MakeGraphQLRequestOK(query)
				before := xEnv.SubgraphRequestCount.Mood.Load()
				xEnv.MakeGraphQLRequestOK(query)
				return xEnv.SubgraphRequestCount.Mood.Load() == before
			}, 5*time.Second, 20*time.Millisecond)
		})
	})
}
