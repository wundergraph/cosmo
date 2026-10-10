package core

import (
	"context"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"github.com/wundergraph/cosmo/router/pkg/metric"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func TestResponseCacheStats(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		statuses []resolve.ResponseCacheStatus
		want     resolve.ResponseCacheStatus
	}{
		{
			name: "every fetch a hit is a hit",
			statuses: []resolve.ResponseCacheStatus{
				resolve.ResponseCacheStatusHit,
				resolve.ResponseCacheStatusHit,
			},
			want: resolve.ResponseCacheStatusHit,
		},
		{
			name: "a hit next to a miss is a partial hit",
			statuses: []resolve.ResponseCacheStatus{
				resolve.ResponseCacheStatusHit,
				resolve.ResponseCacheStatusMiss,
			},
			want: resolve.ResponseCacheStatusPartialHit,
		},
		{
			name:     "a partial hit alone is a partial hit",
			statuses: []resolve.ResponseCacheStatus{resolve.ResponseCacheStatusPartialHit},
			want:     resolve.ResponseCacheStatusPartialHit,
		},
		{
			name: "a partial hit next to hits is a partial hit",
			statuses: []resolve.ResponseCacheStatus{
				resolve.ResponseCacheStatusHit,
				resolve.ResponseCacheStatusPartialHit,
			},
			want: resolve.ResponseCacheStatusPartialHit,
		},
		{
			name: "only misses is a miss",
			statuses: []resolve.ResponseCacheStatus{
				resolve.ResponseCacheStatusMiss,
				resolve.ResponseCacheStatusMiss,
			},
			want: resolve.ResponseCacheStatusMiss,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			rc := newTestRequestContext(t)
			for _, status := range tt.statuses {
				rc.responseCache.record(status)
			}
			status, ok := rc.responseCacheStatus()
			require.True(t, ok)
			require.Equal(t, tt.want, status)
		})
	}

	t.Run("no fetch has no status", func(t *testing.T) {
		t.Parallel()

		_, ok := newTestRequestContext(t).responseCacheStatus()
		require.False(t, ok)
	})

	t.Run("fetches record concurrently", func(t *testing.T) {
		t.Parallel()

		rc := newTestRequestContext(t)
		var wg sync.WaitGroup
		for range 64 {
			wg.Go(func() {
				rc.responseCache.record(resolve.ResponseCacheStatusHit)
			})
		}
		wg.Wait()

		require.EqualValues(t, 64, rc.responseCache.fetches.Load())
		status, ok := rc.responseCacheStatus()
		require.True(t, ok)
		require.Equal(t, resolve.ResponseCacheStatusHit, status)
	})

	for _, opType := range []OperationType{OperationTypeSubscription, OperationTypeMutation} {
		t.Run("a "+opType+" has no status", func(t *testing.T) {
			t.Parallel()

			rc := newTestRequestContext(t)
			rc.operation.opType = opType
			rc.responseCache.record(resolve.ResponseCacheStatusNotCacheable)

			_, ok := rc.responseCacheStatus()
			require.False(t, ok)
		})
	}
}

// requestCountSpy keeps the attributes the request counter was measured with.
type requestCountSpy struct {
	metric.NoopMetrics
	attrs attribute.Set
}

func (m *requestCountSpy) MeasureRequestCount(
	_ context.Context, _ []attribute.KeyValue, opt otelmetric.AddOption,
) {
	m.attrs = otelmetric.NewAddConfig([]otelmetric.AddOption{opt}).Attributes()
}

func TestFinishResponseCacheStatus(t *testing.T) {
	t.Parallel()

	finish := func(t *testing.T, rc *requestContext) attribute.Set {
		t.Helper()

		store := &requestCountSpy{}
		m := &OperationMetrics{
			routerMetrics:  &spyRouterMetrics{store: store},
			inflightMetric: func() {},
		}
		m.Finish(rc, http.StatusOK, 100, false)
		return store.attrs
	}

	t.Run("the request counter carries the status of the response", func(t *testing.T) {
		t.Parallel()

		rc := newTestRequestContext(t)
		rc.responseCache.record(resolve.ResponseCacheStatusHit)
		rc.responseCache.record(resolve.ResponseCacheStatusMiss)

		attrs := finish(t, rc)
		status, ok := attrs.Value(rotel.WgOperationResponseCacheStatus)
		require.True(t, ok)
		require.Equal(t, resolve.ResponseCacheStatusPartialHit.String(), status.AsString())
	})

	t.Run("nothing is attached when no fetch was counted", func(t *testing.T) {
		t.Parallel()

		attrs := finish(t, newTestRequestContext(t))
		_, ok := attrs.Value(rotel.WgOperationResponseCacheStatus)
		require.False(t, ok)
	})
}

func TestOnFinished_RecordsResponseCacheStatus(t *testing.T) {
	t.Parallel()

	ds := resolve.DataSourceInfo{ID: "subgraph-1", Name: "products"}

	t.Run("a fetch is counted on the request", func(t *testing.T) {
		t.Parallel()

		tp := sdktrace.NewTracerProvider()
		hooks := NewEngineRequestHooks(&spyMetricStore{}, nil, tp, nil, nil, nil, false, nil, true, nil)

		ctx, rc := setupTestContext(t, tp)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{
			StatusCode: http.StatusOK,
			ResponseCache: resolve.ResponseCacheInfo{
				Status: resolve.ResponseCacheStatusHit,
			},
		})
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{StatusCode: http.StatusOK})

		status, ok := rc.responseCacheStatus()
		require.True(t, ok)
		require.Equal(t, resolve.ResponseCacheStatusPartialHit, status,
			"a fetch that is not cacheable counts against a hit")
	})

	t.Run("a fetch without hook context is still counted", func(t *testing.T) {
		t.Parallel()

		hooks := NewEngineRequestHooks(&spyMetricStore{}, nil, sdktrace.NewTracerProvider(), nil, nil, nil, false, nil, true, nil)

		rc := newTestRequestContext(t)
		ctx := withRequestContext(context.Background(), rc)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{
			StatusCode: http.StatusOK,
			ResponseCache: resolve.ResponseCacheInfo{
				Status: resolve.ResponseCacheStatusHit,
			},
		})

		status, ok := rc.responseCacheStatus()
		require.True(t, ok)
		require.Equal(t, resolve.ResponseCacheStatusHit, status)
	})

	t.Run("nothing is counted while the cache is not enabled", func(t *testing.T) {
		t.Parallel()

		tp := sdktrace.NewTracerProvider()
		hooks := NewEngineRequestHooks(&spyMetricStore{}, nil, tp, nil, nil, nil, false, nil, false, nil)

		ctx, rc := setupTestContext(t, tp)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{StatusCode: http.StatusOK})

		_, ok := rc.responseCacheStatus()
		require.False(t, ok)
	})
}
