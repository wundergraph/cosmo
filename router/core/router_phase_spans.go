package core

import (
	"context"
	"net/http"
	"time"

	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

const minRouterPhaseSpanDuration = 100 * time.Microsecond

type responseFinalizationTraceState struct {
	start             time.Time
	parentSpanContext trace.SpanContext
}

type responseFinalizationTraceStateKey struct{}

func emitRouterPhaseSpan(ctx context.Context, tracer trace.Tracer, name string, start time.Time, duration time.Duration, attrs ...attribute.KeyValue) {
	emitRouterPhaseSpanWithParent(trace.SpanContextFromContext(ctx), tracer, name, start, duration, attrs...)
}

func emitRouterPhaseSpanWithParent(parent trace.SpanContext, tracer trace.Tracer, name string, start time.Time, duration time.Duration, attrs ...attribute.KeyValue) {
	if tracer == nil || start.IsZero() || duration < minRouterPhaseSpanDuration {
		return
	}

	if !parent.IsValid() {
		return
	}

	parentCtx := trace.ContextWithSpanContext(context.Background(), parent)
	_, span := tracer.Start(parentCtx, name,
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithTimestamp(start),
		trace.WithAttributes(attrs...),
	)
	span.End(trace.WithTimestamp(start.Add(duration)))
}

func responseFinalizationSpanMiddleware(wrapper func(http.Handler) http.HandlerFunc, tracer trace.Tracer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		wrapped := wrapper(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)

			state, _ := r.Context().Value(responseFinalizationTraceStateKey{}).(*responseFinalizationTraceState)
			if state != nil {
				state.start = time.Now()
			}
		}))

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			state := &responseFinalizationTraceState{
				parentSpanContext: trace.SpanContextFromContext(r.Context()),
			}
			r = r.WithContext(context.WithValue(r.Context(), responseFinalizationTraceStateKey{}, state))

			wrapped.ServeHTTP(w, r)
			emitRouterPhaseSpanWithParent(state.parentSpanContext, tracer, "Router - Finalize Response", state.start, time.Since(state.start), rotel.RouterServerAttribute)
		})
	}
}
