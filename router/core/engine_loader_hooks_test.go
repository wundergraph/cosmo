package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/astjson"
	rcontext "github.com/wundergraph/cosmo/router/internal/context"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	otelmetric "go.opentelemetry.io/otel/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func setupTestContext(t *testing.T, tp *sdktrace.TracerProvider) (context.Context, *requestContext) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/graphql", nil)
	rc := buildRequestContext(requestContextOptions{r: req})
	rc.operation = &operationContext{}

	ctx := context.WithValue(req.Context(), rcontext.RequestContextKey, rc)

	tracer := tp.Tracer("test")
	ctx, _ = tracer.Start(ctx, "Engine - Fetch")
	ctx = context.WithValue(ctx, rcontext.EngineLoaderHooksContextKey, &engineLoaderHooksRequestContext{
		startTime: time.Now(),
	})

	return ctx, rc
}

func TestOnFinished_ClientDisconnect(t *testing.T) {
	t.Parallel()

	ds := resolve.DataSourceInfo{
		ID:   "subgraph-1",
		Name: "products",
	}

	t.Run("context.Canceled does not set span ERROR status", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))

		store := &spyMetricStore{}
		hooks := NewEngineRequestHooks(store, nil, tp, nil, nil, nil, false, nil)

		ctx, _ := setupTestContext(t, tp)

		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{
			Err: context.Canceled,
		})

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		// Span status should NOT be Error for client disconnects
		require.NotEqual(t, codes.Error, spans[0].Status().Code,
			"client disconnect should not set span status to Error")

		// The error should still be recorded as an event for observability
		require.Len(t, spans[0].Events(), 1, "context.Canceled should be recorded as a span event")

		// MeasureRequestError should NOT be called
		require.False(t, store.requestErrorCalled,
			"MeasureRequestError should not be called for client disconnects")
	})

	t.Run("real error sets span ERROR status", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))

		store := &spyMetricStore{}
		hooks := NewEngineRequestHooks(store, nil, tp, nil, nil, nil, false, nil)

		ctx, _ := setupTestContext(t, tp)

		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{
			Err: errors.New("connection refused"),
		})

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		// Span status should be Error for real errors
		require.Equal(t, codes.Error, spans[0].Status().Code,
			"real errors should set span status to Error")

		// MeasureRequestError should be called
		require.True(t, store.requestErrorCalled,
			"MeasureRequestError should be called for real errors")
	})

	t.Run("wrapped context.Canceled does not set span ERROR status", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))

		store := &spyMetricStore{}
		hooks := NewEngineRequestHooks(store, nil, tp, nil, nil, nil, false, nil)

		ctx, _ := setupTestContext(t, tp)

		// Simulate a wrapped context.Canceled error (as would happen through net/http)
		wrappedErr := fmt.Errorf("fetch failed: %w", context.Canceled)
		hooks.OnFinished(ctx, ds, &resolve.ResponseInfo{
			Err: wrappedErr,
		})

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		require.NotEqual(t, codes.Error, spans[0].Status().Code,
			"wrapped context.Canceled should not set span status to Error")
		require.False(t, store.requestErrorCalled,
			"MeasureRequestError should not be called for wrapped context.Canceled")
	})
}

func TestRecordFetchError(t *testing.T) {
	t.Parallel()

	t.Run("sets span status to error and records error event", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		ctx, span := tracer.Start(context.Background(), "test-span")

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}

		fetchErr := errors.New("connection refused")
		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())

		hooks.recordFetchError(ctx, span, fetchErr, rc, nil, metricAddOpt, nil)
		span.End()

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		require.Equal(t, codes.Error, spans[0].Status().Code)
		require.Equal(t, "connection refused", spans[0].Status().Description)

		// Should have an exception event
		require.Len(t, spans[0].Events(), 1)
		require.Equal(t, "exception", spans[0].Events()[0].Name)

		require.True(t, store.requestErrorCalled)
	})

	t.Run("calls MeasureRequestError", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		_, span := tracer.Start(context.Background(), "test-span")
		defer span.End()

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}

		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())
		hooks.recordFetchError(context.Background(), span, errors.New("fail"), rc, nil, metricAddOpt, nil)

		require.True(t, store.requestErrorCalled, "should call MeasureRequestError")
	})

	t.Run("extracts downstream error codes from subgraph errors", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		ctx, span := tracer.Start(context.Background(), "test-span")

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}

		// Build a SubgraphError with downstream errors containing extension codes
		subErr := resolve.NewSubgraphError(resolve.DataSourceInfo{Name: "products"}, "query.products", "upstream error", 500)

		parser := astjson.Parser{}
		ext, _ := parser.Parse(`{"code":"PRODUCT_NOT_FOUND"}`)
		subErr.AppendDownstreamError(&resolve.GraphQLError{
			Message:    "product not found",
			Extensions: ext,
		})

		ext2, _ := parser.Parse(`{"code":"INVALID_INPUT"}`)
		subErr.AppendDownstreamError(&resolve.GraphQLError{
			Message:    "invalid input",
			Extensions: ext2,
		})

		// Wrap as a multi-error (how the engine returns subgraph errors)
		fetchErr := errors.Join(subErr)

		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())
		hooks.recordFetchError(ctx, span, fetchErr, rc, nil, metricAddOpt, nil)
		span.End()

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		// Should have: 1 exception event + 2 downstream error events
		require.Len(t, spans[0].Events(), 3)
		require.Equal(t, "exception", spans[0].Events()[0].Name)
		require.Equal(t, "Downstream error 1", spans[0].Events()[1].Name)
		require.Equal(t, "Downstream error 2", spans[0].Events()[2].Name)

		// Verify downstream error attributes
		event1Attrs := spans[0].Events()[1].Attributes
		require.Contains(t, event1Attrs, rotel.WgSubgraphErrorExtendedCode.String("PRODUCT_NOT_FOUND"))
		require.Contains(t, event1Attrs, rotel.WgSubgraphErrorMessage.String("product not found"))

		event2Attrs := spans[0].Events()[2].Attributes
		require.Contains(t, event2Attrs, rotel.WgSubgraphErrorExtendedCode.String("INVALID_INPUT"))
		require.Contains(t, event2Attrs, rotel.WgSubgraphErrorMessage.String("invalid input"))
	})

	t.Run("handles errors without downstream codes", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		ctx, span := tracer.Start(context.Background(), "test-span")

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}

		// SubgraphError with a downstream error that has no extension code
		subErr := resolve.NewSubgraphError(resolve.DataSourceInfo{Name: "products"}, "query.products", "upstream error", 500)
		subErr.AppendDownstreamError(&resolve.GraphQLError{
			Message: "something went wrong",
			// No Extensions
		})

		fetchErr := errors.Join(subErr)
		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())
		hooks.recordFetchError(ctx, span, fetchErr, rc, nil, metricAddOpt, nil)
		span.End()

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		// Only the exception event, no downstream error events (no codes to report)
		require.Len(t, spans[0].Events(), 1)
		require.Equal(t, "exception", spans[0].Events()[0].Name)

		require.True(t, store.requestErrorCalled)
	})

	t.Run("deduplicates and sorts error codes", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		ctx, span := tracer.Start(context.Background(), "test-span")

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}
		rc.telemetry.metricSetAttrs = map[string]string{
			ContextFieldGraphQLErrorCodes: "graphql.error.codes",
		}

		parser := astjson.Parser{}

		// Two subgraph errors with duplicate and unsorted codes
		subErr1 := resolve.NewSubgraphError(resolve.DataSourceInfo{Name: "products"}, "query.products", "err1", 500)
		ext1, _ := parser.Parse(`{"code":"ZEBRA_ERROR"}`)
		subErr1.AppendDownstreamError(&resolve.GraphQLError{Message: "z", Extensions: ext1})
		ext2, _ := parser.Parse(`{"code":"ALPHA_ERROR"}`)
		subErr1.AppendDownstreamError(&resolve.GraphQLError{Message: "a", Extensions: ext2})

		subErr2 := resolve.NewSubgraphError(resolve.DataSourceInfo{Name: "users"}, "query.users", "err2", 500)
		ext3, _ := parser.Parse(`{"code":"ALPHA_ERROR"}`) // duplicate
		subErr2.AppendDownstreamError(&resolve.GraphQLError{Message: "a2", Extensions: ext3})

		fetchErr := errors.Join(subErr1, subErr2)
		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())
		hooks.recordFetchError(ctx, span, fetchErr, rc, nil, metricAddOpt, nil)
		span.End()

		// Find the error codes attribute captured by the spy metric store
		var foundCodes []string
		for _, attr := range store.requestErrorSliceAttr {
			if string(attr.Key) == "graphql.error.codes" {
				foundCodes = attr.Value.AsStringSlice()
			}
		}

		require.Equal(t, []string{"ALPHA_ERROR", "ZEBRA_ERROR"}, foundCodes,
			"error codes should be deduplicated and sorted")
	})

	t.Run("preserves pre-populated slice attrs alongside error codes", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		ctx, span := tracer.Start(context.Background(), "test-span")

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}
		rc.telemetry.metricSetAttrs = map[string]string{
			ContextFieldGraphQLErrorCodes: "graphql.error.codes",
		}

		parser := astjson.Parser{}
		subErr := resolve.NewSubgraphError(resolve.DataSourceInfo{Name: "products"}, "query.products", "err", 500)
		ext, _ := parser.Parse(`{"code":"SOME_CODE"}`)
		subErr.AppendDownstreamError(&resolve.GraphQLError{Message: "m", Extensions: ext})

		fetchErr := errors.Join(subErr)
		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())

		// Simulate the caller pattern: pass a pre-populated slice (like AcquireAttributes + append base attrs)
		prePopulated := []attribute.KeyValue{
			attribute.String("existing.attr", "value"),
		}

		resultSlice, _ := hooks.recordFetchError(ctx, span, fetchErr, rc, nil, metricAddOpt, prePopulated)
		span.End()

		// The returned slice should contain both the pre-existing attr and the error codes
		var hasExisting, hasErrorCodes bool
		for _, attr := range resultSlice {
			if string(attr.Key) == "existing.attr" {
				hasExisting = true
			}
			if string(attr.Key) == "graphql.error.codes" {
				hasErrorCodes = true
			}
		}
		require.True(t, hasExisting, "pre-populated attrs should be preserved")
		require.True(t, hasErrorCodes, "error codes should be appended")
	})

	t.Run("plain error without multi-error wrapper", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)
		tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
		tracer := tp.Tracer("test")

		ctx, span := tracer.Start(context.Background(), "test-span")

		store := &spyMetricStore{}
		hooks := &engineLoaderHooks{metricStore: store}

		rc := buildRequestContext(requestContextOptions{
			r: httptest.NewRequest(http.MethodPost, "/graphql", nil),
		})
		rc.operation = &operationContext{}

		// A plain error (not a multi-error, not a SubgraphError)
		fetchErr := errors.New("dial tcp: connection refused")
		metricAddOpt := otelmetric.WithAttributeSet(attribute.NewSet())
		hooks.recordFetchError(ctx, span, fetchErr, rc, nil, metricAddOpt, nil)
		span.End()

		spans := exporter.GetSpans().Snapshots()
		require.Len(t, spans, 1)

		require.Equal(t, codes.Error, spans[0].Status().Code)
		// Only the exception event, no downstream error events
		require.Len(t, spans[0].Events(), 1)
		require.True(t, store.requestErrorCalled)
	})
}

