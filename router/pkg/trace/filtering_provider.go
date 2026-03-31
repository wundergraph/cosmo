package trace

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// semconvDropKeys lists new-semconv attribute keys emitted by otelhttp v0.67.0
// that had no equivalent in the old otelhttp and must be dropped for backward
// compatibility with downstream systems (dashboards, alerts, tracing UIs).
var semconvDropKeys = map[attribute.Key]struct{}{
	"url.path":              {}, // redundant with http.target already set by the router
	"client.address":        {}, // not emitted by old otelhttp; would surface as new http.client_ip
	"network.local.address": {}, // new in otelhttp v0.67.0, no old equivalent
	"network.local.port":    {}, // new in otelhttp v0.67.0, no old equivalent
}

// FilteringTracerProvider wraps a TracerProvider and returns spans that
// silently drop attributes listed in semconvDropKeys. This covers attributes
// set both at span creation time (via WithAttributes) and afterwards (via
// SetAttributes).
//
// This approach is necessary because:
//   - SpanProcessor.OnStart receives a ReadWriteSpan but SetAttributes only
//     appends — it cannot remove attributes already set via WithAttributes
//     during Start.
//   - SpanProcessor.OnEnd receives a ReadOnlySpan snapshot whose Attributes()
//     slice can be mutated in-place (values/keys) but cannot be resized.
//
// By intercepting at the Tracer.Start level, we filter the WithAttributes
// options before the underlying span is created, so dropped attributes never
// enter the span.
type FilteringTracerProvider struct {
	oteltrace.TracerProvider
}

func (p *FilteringTracerProvider) Tracer(name string, opts ...oteltrace.TracerOption) oteltrace.Tracer {
	return &filteringTracer{Tracer: p.TracerProvider.Tracer(name, opts...)}
}

type filteringTracer struct {
	oteltrace.Tracer
}

// Start filters the WithAttributes options before the underlying span is created, so dropped attributes never enter the span.
// This is a workaround because SpanProcessor.OnStart receives a ReadWriteSpan but SetAttributes only appends — it cannot remove attributes already set via WithAttributes during Start.
// The OTEL SDK does not provide a way to remove attributes from a span after it has been created.
// This is temporary solution to ensure that our metrics are backward compatible for now.
// TODO: Remove this once we want to ingest the new attributes.
func (t *filteringTracer) Start(ctx context.Context, name string, opts ...oteltrace.SpanStartOption) (context.Context, oteltrace.Span) {
	// Extract the SpanConfig to inspect attributes set via WithAttributes.
	cfg := oteltrace.NewSpanStartConfig(opts...)
	startAttrs := cfg.Attributes()

	if len(startAttrs) > 0 {
		// Filter out dropped keys and rebuild the options without the
		// original WithAttributes, replacing it with a filtered version.
		filtered := make([]attribute.KeyValue, 0, len(startAttrs))
		for _, a := range startAttrs {
			if _, drop := semconvDropKeys[a.Key]; !drop {
				filtered = append(filtered, a)
			}
		}

		// Rebuild options: keep all non-attribute options, add filtered attributes.
		rebuilt := make([]oteltrace.SpanStartOption, 0, len(opts)+1)
		for _, opt := range opts {
			// Skip WithAttributes options — we'll add our filtered version.
			if _, isAttr := opt.(oteltrace.SpanStartEventOption); isAttr {
				continue
			}
			rebuilt = append(rebuilt, opt)
		}
		rebuilt = append(rebuilt, oteltrace.WithAttributes(filtered...))
		opts = rebuilt
	}

	ctx, span := t.Tracer.Start(ctx, name, opts...)
	return ctx, &filteringSpan{Span: span}
}

type filteringSpan struct {
	oteltrace.Span
}

func (s *filteringSpan) SetAttributes(kv ...attribute.KeyValue) {
	n := 0
	for i := range kv {
		if _, drop := semconvDropKeys[kv[i].Key]; !drop {
			kv[n] = kv[i]
			n++
		}
	}
	s.Span.SetAttributes(kv[:n]...)
}
