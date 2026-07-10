package testenv

import (
	"crypto/tls"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
	"go.uber.org/atomic"
)

func TestStartDeferDemoSubgraphsDisabled(t *testing.T) {
	fixture := startDeferDemoSubgraphs(t, &Config{}, deferDemoTestCounters())

	assert.Empty(t, fixture.servers())
	assert.Empty(t, fixture.replacements())
}

func TestStartDeferDemoSubgraphsEnabled(t *testing.T) {
	fixture := startDeferDemoSubgraphs(t, &Config{EnableDeferDemoSubgraphs: true}, deferDemoTestCounters())
	servers := fixture.servers()
	closeDeferDemoTestServers(t, servers)

	require.Len(t, servers, 3)
	assert.Equal(t, map[string]string{
		subgraphs.CatalogDefaultDemoURL: GqlURL(servers[0]),
		subgraphs.PricingDefaultDemoURL: GqlURL(servers[1]),
		subgraphs.ReviewsDefaultDemoURL: GqlURL(servers[2]),
	}, fixture.replacements())
}

func TestStartDeferDemoSubgraphsRegistersCleanup(t *testing.T) {
	var servers []*httptest.Server
	t.Run("fixture lifetime", func(t *testing.T) {
		fixture := startDeferDemoSubgraphs(t, &Config{EnableDeferDemoSubgraphs: true}, deferDemoTestCounters())
		servers = fixture.servers()
		require.Len(t, servers, 3)
	})

	for i, server := range servers {
		conn, err := net.DialTimeout("tcp", server.Listener.Addr().String(), 100*time.Millisecond)
		if err == nil {
			require.NoError(t, conn.Close())
			server.Close()
		}
		require.Error(t, err, "server %d still accepts connections after test cleanup", i)
	}
}

func TestStartDeferDemoSubgraphsRegistersEachCleanupBeforeStartingNext(t *testing.T) {
	const panicValue = "pricing startup failed"
	var catalogServer *httptest.Server
	startCalls := 0

	t.Run("startup failure", func(t *testing.T) {
		defer func() {
			assert.Equal(t, panicValue, recover())
		}()

		_ = startDeferDemoSubgraphsWith(t, &Config{EnableDeferDemoSubgraphs: true}, deferDemoTestCounters(), func(t testing.TB, handler http.Handler, tlsConfig *tls.Config) *httptest.Server {
			startCalls++
			if startCalls == 2 {
				panic(panicValue)
			}
			catalogServer = makeSubgraphTestServer(t, handler, tlsConfig)
			return catalogServer
		})
	})

	require.NotNil(t, catalogServer)
	conn, err := net.DialTimeout("tcp", catalogServer.Listener.Addr().String(), 100*time.Millisecond)
	if err == nil {
		require.NoError(t, conn.Close())
		catalogServer.Close()
	}
	require.Error(t, err, "catalog server still accepts connections after later startup panic")
}

func TestDeferDemoSubgraphsCloseOnStart(t *testing.T) {
	tests := []struct {
		name       string
		configure  func(*Config)
		closedSlot int
	}{
		{
			name: "catalog",
			configure: func(cfg *Config) {
				cfg.Subgraphs.Catalog.CloseOnStart = true
			},
			closedSlot: 0,
		},
		{
			name: "pricing",
			configure: func(cfg *Config) {
				cfg.Subgraphs.Pricing.CloseOnStart = true
			},
			closedSlot: 1,
		},
		{
			name: "reviews",
			configure: func(cfg *Config) {
				cfg.Subgraphs.Reviews.CloseOnStart = true
			},
			closedSlot: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &Config{EnableDeferDemoSubgraphs: true}
			tt.configure(cfg)
			fixture := startDeferDemoSubgraphs(t, cfg, deferDemoTestCounters())
			servers := fixture.servers()
			closeDeferDemoTestServers(t, servers)

			fixture.closeOnStart(cfg.Subgraphs)

			for i, server := range servers {
				conn, err := net.DialTimeout("tcp", server.Listener.Addr().String(), 100*time.Millisecond)
				if i == tt.closedSlot {
					assert.Error(t, err, "server %d should be closed", i)
					continue
				}
				require.NoError(t, err, "server %d should remain open", i)
				require.NoError(t, conn.Close())
			}
		})
	}
}

func TestMergeNonEmptyReplacements(t *testing.T) {
	replacements := map[string]string{"existing": "original"}

	mergeNonEmptyReplacements(replacements, map[string]string{
		"existing": "",
		"empty":    "",
		"added":    "replacement",
	})

	assert.Equal(t, map[string]string{
		"existing": "original",
		"added":    "replacement",
	}, replacements)
}

func deferDemoTestCounters() *SubgraphRequestCount {
	return &SubgraphRequestCount{
		Global:  atomic.NewInt64(0),
		Catalog: atomic.NewInt64(0),
		Pricing: atomic.NewInt64(0),
		Reviews: atomic.NewInt64(0),
	}
}

func closeDeferDemoTestServers(t *testing.T, servers []*httptest.Server) {
	t.Helper()
	t.Cleanup(func() {
		for _, server := range servers {
			server.Close()
		}
	})
}
