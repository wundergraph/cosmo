package core

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"

	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
)

func newCachingOptionsHandler(entity EntityCachingHandlerOptions) *GraphQLHandler {
	return &GraphQLHandler{entityCaching: entity}
}

func newCachingOptionsReqCtx(t *testing.T, traceEnabled bool, headers map[string]string) *requestContext {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	return &requestContext{
		request: req,
		operation: &operationContext{
			traceOptions: resolve.TraceOptions{Enable: traceEnabled},
		},
	}
}

func TestGraphQLHandler_cachingOptions_DefaultsFromHandler(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled:       true,
		L2Enabled:       true,
		GlobalKeyPrefix: "router-a",
	})
	reqCtx := newCachingOptionsReqCtx(t, false, nil)

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         true,
		EnableL2Cache:         true,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "router-a",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_DisableCacheHeaderIgnoredWithoutTracing(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled: true,
		L2Enabled: true,
	})
	// Tracing NOT enabled — headers should be ignored.
	reqCtx := newCachingOptionsReqCtx(t, false, map[string]string{
		disableEntityCacheHeader:   "true",
		disableEntityCacheL1Header: "true",
		disableEntityCacheL2Header: "true",
		cacheKeyPrefixHeader:       "ignored",
	})

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         true,
		EnableL2Cache:         true,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_DisableAllWithTracing(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled: true,
		L2Enabled: true,
	})
	reqCtx := newCachingOptionsReqCtx(t, true, map[string]string{
		disableEntityCacheHeader: "true",
	})

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         false,
		EnableL2Cache:         false,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_DisableL1Only(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled: true,
		L2Enabled: true,
	})
	reqCtx := newCachingOptionsReqCtx(t, true, map[string]string{
		disableEntityCacheL1Header: "true",
	})

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         false,
		EnableL2Cache:         true,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_DisableL2Only(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled: true,
		L2Enabled: true,
	})
	reqCtx := newCachingOptionsReqCtx(t, true, map[string]string{
		disableEntityCacheL2Header: "true",
	})

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         true,
		EnableL2Cache:         false,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_CacheKeyPrefixPrependsToGlobal(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled:       true,
		L2Enabled:       true,
		GlobalKeyPrefix: "base",
	})
	reqCtx := newCachingOptionsReqCtx(t, true, map[string]string{
		cacheKeyPrefixHeader: "req-42",
	})

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         true,
		EnableL2Cache:         true,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "req-42:base",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_CacheKeyPrefixReplacesEmptyGlobal(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled: true,
		L2Enabled: true,
	})
	reqCtx := newCachingOptionsReqCtx(t, true, map[string]string{
		cacheKeyPrefixHeader: "standalone",
	})

	opts := h.cachingOptions(reqCtx)
	require.Equal(t, resolve.CachingOptions{
		EnableL1Cache:         true,
		EnableL2Cache:         true,
		EnableCacheAnalytics:  false,
		GlobalCacheKeyPrefix:  "standalone",
		L2CacheKeyInterceptor: nil,
	}, opts)
}

func TestGraphQLHandler_cachingOptions_MetricsEnablesAnalytics(t *testing.T) {
	t.Parallel()
	h := newCachingOptionsHandler(EntityCachingHandlerOptions{
		L1Enabled: true,
		L2Enabled: true,
		Metrics:   []*rmetric.EntityCacheMetrics{nil}, // just non-empty slice
	})
	reqCtx := newCachingOptionsReqCtx(t, false, nil)

	opts := h.cachingOptions(reqCtx)
	require.True(t, opts.EnableCacheAnalytics)
}
