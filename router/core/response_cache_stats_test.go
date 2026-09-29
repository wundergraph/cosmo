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
		statuses []string
		want     string
	}{
		{name: "no fetch has no status", want: ""},
		{
			name:     "every fetch a hit is a hit",
			statuses: []string{ResponseCacheStatusHit, ResponseCacheStatusHit},
			want:     ResponseCacheStatusHit,
		},
		{
			name:     "a hit next to a miss is a partial hit",
			statuses: []string{ResponseCacheStatusHit, ResponseCacheStatusMiss},
			want:     ResponseCacheStatusPartialHit,
		},
		{
			name:     "a partial hit alone is a partial hit",
			statuses: []string{ResponseCacheStatusPartialHit},
			want:     ResponseCacheStatusPartialHit,
		},
		{
			name:     "a partial hit next to hits is a partial hit",
			statuses: []string{ResponseCacheStatusHit, ResponseCacheStatusPartialHit},
			want:     ResponseCacheStatusPartialHit,
		},
		{
			name:     "only misses is a miss",
			statuses: []string{ResponseCacheStatusMiss, ResponseCacheStatusMiss},
			want:     ResponseCacheStatusMiss,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var stats responseCacheStats
			for _, status := range tt.statuses {
				stats.record(status)
			}
			require.Equal(t, tt.want, stats.status())
		})
	}

	t.Run("fetches record concurrently", func(t *testing.T) {
		t.Parallel()

		var stats responseCacheStats
		var wg sync.WaitGroup
		for range 64 {
			wg.Go(func() {
				stats.record(ResponseCacheStatusHit)
			})
		}
		wg.Wait()

		require.EqualValues(t, 64, stats.fetches.Load())
		require.Equal(t, ResponseCacheStatusHit, stats.status())
	})

	t.Run("a subscription has no status", func(t *testing.T) {
		t.Parallel()

		rc := newTestRequestContext(t)
		rc.operation.opType = OperationTypeSubscription
		rc.responseCache.record(ResponseCacheStatusHit)

		require.Empty(t, rc.responseCacheStatus())
	})
}

// requestCountSpy keeps the attributes the request counter was measured with.
type requestCountSpy struct {
	metric.NoopMetrics
	attrs attribute.Set
}

func (m *requestCountSpy) MeasureRequestCount(_ context.Context, _ []attribute.KeyValue, opt otelmetric.AddOption) {
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
		rc.responseCache.record(ResponseCacheStatusHit)
		rc.responseCache.record(ResponseCacheStatusMiss)

		attrs := finish(t, rc)
		status, ok := attrs.Value(rotel.WgOperationResponseCacheStatus)
		require.True(t, ok)
		require.Equal(t, ResponseCacheStatusPartialHit, status.AsString())
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
		hooks := NewEngineRequestHooks(&spyMetricStore{}, nil, tp, nil, nil, nil, false, nil, true)

		ctx, rc := setupTestContext(t, tp)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{StatusCode: http.StatusOK, ResponseCache: resolve.ResponseCacheInfo{Status: resolve.ResponseCacheStatusHit}})
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{StatusCode: http.StatusOK})

		require.Equal(t, ResponseCacheStatusPartialHit, rc.responseCacheStatus(), "a fetch that is not cacheable counts against a hit")
	})

	t.Run("a fetch without hook context is still counted", func(t *testing.T) {
		t.Parallel()

		hooks := NewEngineRequestHooks(&spyMetricStore{}, nil, sdktrace.NewTracerProvider(), nil, nil, nil, false, nil, true)

		rc := newTestRequestContext(t)
		ctx := withRequestContext(context.Background(), rc)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{StatusCode: http.StatusOK, ResponseCache: resolve.ResponseCacheInfo{Status: resolve.ResponseCacheStatusHit}})

		require.Equal(t, ResponseCacheStatusHit, rc.responseCacheStatus())
	})

	t.Run("nothing is counted while the cache is not enabled", func(t *testing.T) {
		t.Parallel()

		tp := sdktrace.NewTracerProvider()
		hooks := NewEngineRequestHooks(&spyMetricStore{}, nil, tp, nil, nil, nil, false, nil, false)

		ctx, rc := setupTestContext(t, tp)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{StatusCode: http.StatusOK})

		require.Empty(t, rc.responseCacheStatus())
	})
}
