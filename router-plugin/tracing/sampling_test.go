package tracing

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/wundergraph/cosmo/router-plugin/config"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	oteltrace "go.opentelemetry.io/otel/trace"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestTraceIDSamplingProcessor(t *testing.T) {
	high := tracetest.NewInMemoryExporter()
	low := tracetest.NewInMemoryExporter()
	none := tracetest.NewInMemoryExporter()

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(newTraceIDSamplingProcessor(sdktrace.NewSimpleSpanProcessor(high), 0.5)),
		sdktrace.WithSpanProcessor(newTraceIDSamplingProcessor(sdktrace.NewSimpleSpanProcessor(low), 0.1)),
		sdktrace.WithSpanProcessor(newTraceIDSamplingProcessor(sdktrace.NewSimpleSpanProcessor(none), 0)),
	)
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
	})

	traceIDs := startTraces(tp.Tracer("test"), remoteParent(oteltrace.FlagsSampled), 1000)

	assertTraces(t, "rate 0.5", sampledTraces(traceIDs, 0.5), spansPerTrace(high))
	assertTraces(t, "rate 0.1", sampledTraces(traceIDs, 0.1), spansPerTrace(low))
	if spans := none.GetSpans(); len(spans) != 0 {
		t.Errorf("rate 0: got %d spans, want none", len(spans))
	}
}

func TestInitTracerExporterSamplingRates(t *testing.T) {
	inherits := newOTLPCollector(t)
	lower := newOTLPCollector(t)

	// The router sends the head rate as the sampler and a rate for every
	// exporter below the global rate.
	tp, err := initTracer(context.Background(), TracingOptions{
		ServiceName: "test",
		TracingConfig: &config.Tracing{
			Sampler: 0.5,
			Exporters: []config.Exporter{
				{Endpoint: inherits.url},
				{Endpoint: lower.url, SamplingRate: new(0.1)},
			},
		},
	})
	if err != nil {
		t.Fatalf("initTracer: %v", err)
	}

	tracer := tp.Tracer("test")
	sampled := startTraces(tracer, remoteParent(oteltrace.FlagsSampled), 500)
	// Plugin spans follow the router's decision, so traces the router did not
	// sample reach no exporter.
	startTraces(tracer, remoteParent(0), 500)

	if err := tp.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown: %v", err)
	}

	assertTraces(t, "exporter without a rate", sampledTraces(sampled, 1), inherits.traces())
	assertTraces(t, "exporter at rate 0.1", sampledTraces(sampled, 0.1), lower.traces())
}

func assertTraces(t *testing.T, name string, want, got map[oteltrace.TraceID]int) {
	t.Helper()
	if !maps.Equal(want, got) {
		t.Errorf("%s: got spans for %d traces, want %d traces with 2 spans each", name, len(got), len(want))
	}
}

// startTraces starts n traces with a root and a child span each, using
// parentContext for every root, and returns their trace IDs.
func startTraces(tracer oteltrace.Tracer, parentContext func() context.Context, n int) []oteltrace.TraceID {
	traceIDs := make([]oteltrace.TraceID, 0, n)
	for range n {
		ctx, root := tracer.Start(parentContext(), "root")
		_, child := tracer.Start(ctx, "child")
		child.End()
		root.End()
		traceIDs = append(traceIDs, root.SpanContext().TraceID())
	}
	return traceIDs
}

// remoteParent returns a function that creates a context carrying a remote
// span of a new random trace with the given flags, like the router's span
// propagated to a plugin.
func remoteParent(flags oteltrace.TraceFlags) func() context.Context {
	return func() context.Context {
		var traceID oteltrace.TraceID
		var spanID oteltrace.SpanID
		_, _ = rand.Read(traceID[:])
		_, _ = rand.Read(spanID[:])
		return oteltrace.ContextWithRemoteSpanContext(context.Background(), oteltrace.NewSpanContext(oteltrace.SpanContextConfig{
			TraceID:    traceID,
			SpanID:     spanID,
			TraceFlags: flags,
			Remote:     true,
		}))
	}
}

// sampledTraces returns the traces of traceIDs that a trace ID ratio sampler
// selects at rate, with the two spans started per trace by startTraces. The
// router's per-exporter sampling uses the same sampler.
func sampledTraces(traceIDs []oteltrace.TraceID, rate float64) map[oteltrace.TraceID]int {
	sampler := sdktrace.TraceIDRatioBased(rate)
	result := make(map[oteltrace.TraceID]int)
	for _, traceID := range traceIDs {
		decision := sampler.ShouldSample(sdktrace.SamplingParameters{
			ParentContext: context.Background(),
			TraceID:       traceID,
		}).Decision
		if decision == sdktrace.RecordAndSample {
			result[traceID] = 2
		}
	}
	return result
}

func spansPerTrace(exporter *tracetest.InMemoryExporter) map[oteltrace.TraceID]int {
	result := make(map[oteltrace.TraceID]int)
	for _, span := range exporter.GetSpans() {
		result[span.SpanContext.TraceID()]++
	}
	return result
}

// otlpCollector is an OTLP/HTTP trace endpoint that counts the spans it
// receives per trace.
type otlpCollector struct {
	url   string
	mu    sync.Mutex
	spans map[oteltrace.TraceID]int
}

func newOTLPCollector(t *testing.T) *otlpCollector {
	t.Helper()

	c := &otlpCollector{spans: make(map[oteltrace.TraceID]int)}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := io.Reader(r.Body)
		if r.Header.Get("Content-Encoding") == "gzip" {
			gz, err := gzip.NewReader(r.Body)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			defer func() { _ = gz.Close() }()
			body = gz
		}
		data, err := io.ReadAll(body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var request coltracepb.ExportTraceServiceRequest
		if err := proto.Unmarshal(data, &request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		c.mu.Lock()
		for _, resourceSpans := range request.GetResourceSpans() {
			for _, scopeSpans := range resourceSpans.GetScopeSpans() {
				for _, span := range scopeSpans.GetSpans() {
					c.spans[oteltrace.TraceID(span.GetTraceId())]++
				}
			}
		}
		c.mu.Unlock()

		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	c.url = server.URL
	return c
}

func (c *otlpCollector) traces() map[oteltrace.TraceID]int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return maps.Clone(c.spans)
}
