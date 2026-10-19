package integration

import (
	"fmt"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/wundergraph/cosmo/router-tests/freeport"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
)

// stallProxy forwards to the test redis until stall, then holds every byte,
// like a paused or black-holed redis: connections stay open, nothing answers.
type stallProxy struct {
	ln      net.Listener
	stalled chan struct{}
	once    sync.Once
	done    chan struct{}
}

func newStallProxy(t *testing.T) *stallProxy {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	p := &stallProxy{ln: ln, stalled: make(chan struct{}), done: make(chan struct{})}
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

func (p *stallProxy) url() string { return "redis://" + p.ln.Addr().String() }

func (p *stallProxy) stall() { p.once.Do(func() { close(p.stalled) }) }

func (p *stallProxy) pipe(dst, src net.Conn) {
	defer func() { _ = dst.Close() }()
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
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

		proxy := newStallProxy(t)
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
			require.Less(t, elapsed, 1500*time.Millisecond)
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
}
