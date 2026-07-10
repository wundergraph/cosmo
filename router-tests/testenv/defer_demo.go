package testenv

import (
	"crypto/tls"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/wundergraph/cosmo/demo/pkg/subgraphs"
)

type deferDemoSubgraphs struct {
	catalog *httptest.Server
	pricing *httptest.Server
	reviews *httptest.Server
}

func startDeferDemoSubgraphs(t testing.TB, cfg *Config, counters *SubgraphRequestCount) deferDemoSubgraphs {
	return startDeferDemoSubgraphsWith(t, cfg, counters, makeSubgraphTestServer)
}

func startDeferDemoSubgraphsWith(
	t testing.TB,
	cfg *Config,
	counters *SubgraphRequestCount,
	startServer func(testing.TB, http.Handler, *tls.Config) *httptest.Server,
) deferDemoSubgraphs {
	t.Helper()
	if !cfg.EnableDeferDemoSubgraphs {
		return deferDemoSubgraphs{}
	}

	catalog := &Subgraph{
		handler:          subgraphs.CatalogHandler(nil),
		middleware:       cfg.Subgraphs.Catalog.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Catalog,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Catalog.Delay,
	}
	pricing := &Subgraph{
		handler:          subgraphs.PricingHandler(nil),
		middleware:       cfg.Subgraphs.Pricing.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Pricing,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Pricing.Delay,
	}
	reviews := &Subgraph{
		handler:          subgraphs.ReviewsHandler(nil),
		middleware:       cfg.Subgraphs.Reviews.Middleware,
		globalMiddleware: cfg.Subgraphs.GlobalMiddleware,
		globalCounter:    counters.Global,
		localCounter:     counters.Reviews,
		globalDelay:      cfg.Subgraphs.GlobalDelay,
		localDelay:       cfg.Subgraphs.Reviews.Delay,
	}

	catalogServer := startServer(t, catalog, cfg.Subgraphs.Catalog.TLSConfig)
	registerDeferDemoServerCleanup(t, catalogServer)
	pricingServer := startServer(t, pricing, cfg.Subgraphs.Pricing.TLSConfig)
	registerDeferDemoServerCleanup(t, pricingServer)
	reviewsServer := startServer(t, reviews, cfg.Subgraphs.Reviews.TLSConfig)
	registerDeferDemoServerCleanup(t, reviewsServer)

	return deferDemoSubgraphs{
		catalog: catalogServer,
		pricing: pricingServer,
		reviews: reviewsServer,
	}
}

func registerDeferDemoServerCleanup(t testing.TB, server *httptest.Server) {
	t.Helper()
	t.Cleanup(func() {
		server.CloseClientConnections()
		if err := server.Listener.Close(); err != nil && !errors.Is(err, net.ErrClosed) {
			t.Errorf("could not close defer demo server listener: %v", err)
		}
	})
}

func (d deferDemoSubgraphs) servers() []*httptest.Server {
	servers := make([]*httptest.Server, 0, 3)
	if d.catalog != nil {
		servers = append(servers, d.catalog)
	}
	if d.pricing != nil {
		servers = append(servers, d.pricing)
	}
	if d.reviews != nil {
		servers = append(servers, d.reviews)
	}
	return servers
}

func (d deferDemoSubgraphs) replacements() map[string]string {
	replacements := make(map[string]string, 3)
	if d.catalog != nil {
		replacements[subgraphs.CatalogDefaultDemoURL] = GqlURL(d.catalog)
	}
	if d.pricing != nil {
		replacements[subgraphs.PricingDefaultDemoURL] = GqlURL(d.pricing)
	}
	if d.reviews != nil {
		replacements[subgraphs.ReviewsDefaultDemoURL] = GqlURL(d.reviews)
	}
	return replacements
}

func (d deferDemoSubgraphs) closeOnStart(cfg SubgraphsConfig) {
	if d.catalog != nil && cfg.Catalog.CloseOnStart {
		d.catalog.Close()
	}
	if d.pricing != nil && cfg.Pricing.CloseOnStart {
		d.pricing.Close()
	}
	if d.reviews != nil && cfg.Reviews.CloseOnStart {
		d.reviews.Close()
	}
}

func mergeNonEmptyReplacements(dst, src map[string]string) {
	for key, value := range src {
		if value != "" {
			dst[key] = value
		}
	}
}
