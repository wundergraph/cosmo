package telemetry

import (
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// TestNetworkAndResolverSpans verifies the spans added for network tracing
// (per-phase HTTP child spans under each subgraph request span, plus response
// body read and response processing spans) and resolver tracing (a
// "Resolver - Acquire" child span under "Operation - Execute"). The test
// subgraphs listen on 127.0.0.1 over plain HTTP, so DNS and TLS phases never
// fire; we only assert on the phases that do trigger (TCP connect on first
// connection, time-to-first-byte on every request).
func TestNetworkAndResolverSpans(t *testing.T) {
	t.Parallel()

	t.Run("phase spans are absent by default", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter: exporter,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})

			sn := exporter.GetSpans().Snapshots()
			require.NotEmpty(t, sn)
			require.False(t, hasSpanWithName(sn, "HTTP - DNS Lookup"))
			require.False(t, hasSpanWithName(sn, "HTTP - TCP Connect"))
			require.False(t, hasSpanWithName(sn, "HTTP - TLS Handshake"))
			require.False(t, hasSpanWithName(sn, "HTTP - Time To First Byte"))
			require.False(t, hasSpanWithName(sn, "HTTP - Read Response Body"))
			require.False(t, hasSpanWithName(sn, "Engine - Fetch Response Processing"))
			require.False(t, hasSpanWithName(sn, "Resolver - Acquire"))
			require.False(t, hasSpanWithName(sn, "Operation - Resolve Response"))
			require.False(t, hasSpanWithName(sn, "Router - Write Response"))
			require.False(t, hasSpanWithName(sn, "Telemetry - Record Metrics"))
			require.False(t, hasSpanWithName(sn, "Router - Finalize Response"))
		})
	})

	t.Run("network tracing emits per-phase child spans", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter:       exporter,
			TracingNetworkSpans: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})

			sn := exporter.GetSpans().Snapshots()

			// TCP Connect fires on the first outbound connection to the test
			// subgraph; TTFB fires on every HTTP request. DNS/TLS spans are
			// skipped because subgraphs listen on 127.0.0.1 over plain HTTP.
			tcp := spansByName(sn, "HTTP - TCP Connect")
			require.NotEmpty(t, tcp, "expected at least one TCP Connect span")
			ttfb := spansByName(sn, "HTTP - Time To First Byte")
			require.NotEmpty(t, ttfb, "expected at least one TTFB span")
			bodyRead := spansByName(sn, "HTTP - Read Response Body")
			require.NotEmpty(t, bodyRead, "expected at least one response body read span")
			responseProcessing := spansByName(sn, "Engine - Fetch Response Processing")
			require.NotEmpty(t, responseProcessing, "expected at least one response processing span")

			// Each phase span must have a non-zero, non-error duration.
			spansWithDuration := append(append(append(tcp, ttfb...), bodyRead...), responseProcessing...)
			for _, s := range spansWithDuration {
				require.True(t, s.EndTime().After(s.StartTime()), "phase span %q must end after start", s.Name())
			}

			// Each phase span must be a child of the otelhttp client span for
			// the subgraph request. The client span name comes from the router's
			// span name formatter (e.g. "query unnamed").
			parents := indexByID(sn)
			for _, s := range append(tcp, ttfb...) {
				require.True(t, s.Parent().IsValid(), "phase span %q must have a parent", s.Name())
				parent, ok := parents[s.Parent().SpanID().String()]
				require.True(t, ok, "phase span %q parent must be present in the export", s.Name())
				require.Equal(t, "query unnamed", parent.Name(),
					"phase span %q must be a child of the subgraph HTTP client span", s.Name())
			}

			for _, s := range append(bodyRead, responseProcessing...) {
				require.True(t, s.Parent().IsValid(), "span %q must have a parent", s.Name())
				parent, ok := parents[s.Parent().SpanID().String()]
				require.True(t, ok, "span %q parent must be present in the export", s.Name())
				require.Equal(t, "Engine - Fetch", parent.Name(),
					"span %q must be a child of Engine - Fetch", s.Name())
			}

			// Per-phase spans must carry server attributes (address + subgraph).
			for _, s := range tcp {
				require.True(t, hasAttribute(s, otel.WgSubgraphName, "employees"), "TCP span missing subgraph attribute")
			}
		})
	})

	t.Run("resolver tracing emits a Resolver - Acquire span", func(t *testing.T) {
		t.Parallel()

		exporter := tracetest.NewInMemoryExporter(t)

		testenv.Run(t, &testenv.Config{
			TraceExporter:        exporter,
			TracingResolverSpans: true,
		}, func(t *testing.T, xEnv *testenv.Environment) {
			xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})

			sn := exporter.GetSpans().Snapshots()
			require.True(t, hasSpanWithName(sn, "Resolver - Acquire"),
				"expected a Resolver - Acquire child span when tracing.resolver.enabled is true")

			// The Resolver - Acquire span must be a child of "Operation - Execute".
			parents := indexByID(sn)
			for _, s := range spansByName(sn, "Resolver - Acquire") {
				require.True(t, s.Parent().IsValid(), "Resolver - Acquire span must have a parent")
				parent, ok := parents[s.Parent().SpanID().String()]
				require.True(t, ok, "Resolver - Acquire parent must be in the export")
				require.Equal(t, "Operation - Execute", parent.Name(),
					"Resolver - Acquire must be a child of Operation - Execute")
			}
		})
	})
}

func hasSpanWithName(sn []sdktrace.ReadOnlySpan, name string) bool {
	for _, s := range sn {
		if s.Name() == name {
			return true
		}
	}
	return false
}

func spansByName(sn []sdktrace.ReadOnlySpan, name string) []sdktrace.ReadOnlySpan {
	var out []sdktrace.ReadOnlySpan
	for _, s := range sn {
		if s.Name() == name {
			out = append(out, s)
		}
	}
	return out
}

func indexByID(sn []sdktrace.ReadOnlySpan) map[string]sdktrace.ReadOnlySpan {
	out := make(map[string]sdktrace.ReadOnlySpan, len(sn))
	for _, s := range sn {
		out[s.SpanContext().SpanID().String()] = s
	}
	return out
}

func hasAttribute(s sdktrace.ReadOnlySpan, key attribute.Key, value string) bool {
	for _, a := range s.Attributes() {
		if a.Key == key && a.Value.AsString() == value {
			return true
		}
	}
	return false
}
