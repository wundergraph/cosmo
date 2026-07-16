package trace

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
)

var _ trace.SpanProcessor = (*semconvProcessor)(nil)

// semconvProcessor renames OpenTelemetry semantic conventions
// attribute keys back to their old equivalents (v1.17–v1.21) in the span attributes.
//
// otelhttp v0.67.0 emits new-style attributes (e.g. http.request.method).
// Downstream systems (dashboards, alerts, tracing UIs) may still query by
// old names (e.g. http.method). This processor bridges the gap by renaming
// in-place so both the router's own metrics and otelhttp spans use consistent
// old-style names.
type semconvProcessor struct{}

// Common mappings that apply regardless of span kind.
var semconvCommonMapping = map[attribute.Key]attribute.Key{
	"http.request.method":       "http.method",
	"http.response.status_code": "http.status_code",
	"url.full":                  "http.url",
	"url.scheme":                "http.scheme",
	"network.protocol.version":  "http.flavor",
	"network.peer.address":      "net.sock.peer.addr",
	"network.peer.port":         "net.sock.peer.port",
	"user_agent.original":       "http.user_agent",
	"http.request.body.size":    "http.read_bytes",
	"http.response.body.size":   "http.wrote_bytes",
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

// OnEnd renames the attributes of the span to the old equivalents.
// We currently do this because we want to be backward compatible with the old metrics.
// We will handle this in multiple steps for the migration.
//
// 1. Rewrite the metrics to use the old names and discard the new ones.
// 2. Emit both the old and new names for the same attribute.
// 3. Remove this span processor to only emit the new attributes.
func (*semconvProcessor) OnEnd(s trace.ReadOnlySpan) {
	kind := s.SpanKind()
	attributes := s.Attributes()

	// First iteration: rename the attributes to the old equivalents.
	for i := range attributes {
		if mappedKey, ok := semconvCommonMapping[attributes[i].Key]; ok {
			attributes[i].Key = mappedKey
			continue
		}

		switch kind {
		case oteltrace.SpanKindClient:
			if mappedKey, ok := semconvClientMapping[attributes[i].Key]; ok {
				attributes[i].Key = mappedKey
			}
		case oteltrace.SpanKindServer:
			if mappedKey, ok := semconvServerMapping[attributes[i].Key]; ok {
				attributes[i].Key = mappedKey
			}
		}
	}
}

// ForceFlush does nothing.
func (s *semconvProcessor) ForceFlush(ctx context.Context) error { return nil }

// OnStart does nothing.
func (*semconvProcessor) OnStart(parent context.Context, s trace.ReadWriteSpan) {}

// Shutdown does nothing.
func (s *semconvProcessor) Shutdown(ctx context.Context) error { return nil }
