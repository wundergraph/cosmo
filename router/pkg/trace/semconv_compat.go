package trace

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// semconvCompatProcessor is a SpanProcessor that renames new semconv v1.40.0
// attribute keys back to their old equivalents (v1.17–v1.21) on spans.
//
// otelhttp v0.67.0 emits new-style attributes (e.g. http.request.method).
// Downstream systems (dashboards, alerts, tracing UIs) may still query by
// old names (e.g. http.method). This processor bridges the gap by renaming
// in-place so both the router's own metrics and otelhttp spans use consistent
// old-style names.
type semconvCompatProcessor struct{}

// Common mappings that apply regardless of span kind.
var semconvCommonMapping = map[attribute.Key]attribute.Key{
	"http.request.method":     "http.method",
	"http.response.status_code": "http.status_code",
	"url.full":                "http.url",
	"url.scheme":              "http.scheme",
	"network.protocol.version": "http.flavor",
	"network.peer.address":    "net.sock.peer.addr",
	"network.peer.port":       "net.sock.peer.port",
	"client.address":          "http.client_ip",
	"user_agent.original":     "http.user_agent",
}

// Client span mappings (e.g. otelhttp transport to subgraphs).
var semconvClientMapping = map[attribute.Key]attribute.Key{
	"server.address": "net.peer.name",
	"server.port":    "net.peer.port",
}

// Server span mappings (e.g. otelhttp handler for incoming requests).
var semconvServerMapping = map[attribute.Key]attribute.Key{
	"server.address": "net.host.name",
	"server.port":    "net.host.port",
}

func newSemconvCompatProcessor() sdktrace.SpanProcessor {
	return &semconvCompatProcessor{}
}

func (*semconvCompatProcessor) OnStart(_ context.Context, _ sdktrace.ReadWriteSpan) {}

func (*semconvCompatProcessor) OnEnd(s sdktrace.ReadOnlySpan) {
	kind := s.SpanKind()
	attributes := s.Attributes()

	for i := range attributes {
		// Check common mapping first.
		if oldKey, ok := semconvCommonMapping[attributes[i].Key]; ok {
			attributes[i].Key = oldKey
			continue
		}

		// Apply span-kind-specific mapping.
		switch kind {
		case oteltrace.SpanKindClient:
			if oldKey, ok := semconvClientMapping[attributes[i].Key]; ok {
				attributes[i].Key = oldKey
			}
		case oteltrace.SpanKindServer:
			if oldKey, ok := semconvServerMapping[attributes[i].Key]; ok {
				attributes[i].Key = oldKey
			}
		}
	}
}

func (*semconvCompatProcessor) Shutdown(context.Context) error    { return nil }
func (*semconvCompatProcessor) ForceFlush(context.Context) error  { return nil }
