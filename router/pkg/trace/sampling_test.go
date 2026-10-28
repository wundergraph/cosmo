package trace

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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	oteltrace "go.opentelemetry.io/otel/trace"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"go.uber.org/zap"
	"google.golang.org/protobuf/proto"
)

func TestTraceIDSamplingProcessor(t *testing.T) {
	t.Parallel()

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

	traceIDs := startTraces(t.Context(), tp.Tracer("test"), 1000, false)

	assert.Equal(t, sampledTraces(traceIDs, 0.5), spansPerTrace(high))
	assert.Equal(t, sampledTraces(traceIDs, 0.1), spansPerTrace(low))
	assert.Empty(t, none.GetSpans())
}

func TestNewTracerProviderExporterSamplingRates(t *testing.T) {
	t.Parallel()

	t.Run("exporters receive at most the traces the router records", func(t *testing.T) {
		t.Parallel()

		all := newOTLPCollector(t)
		higher := newOTLPCollector(t)
		lower := newOTLPCollector(t)
		disabled := newOTLPCollector(t)

		tp, err := NewTracerProvider(t.Context(), &ProviderConfig{
			Logger: zap.NewNop(),
			Config: &Config{
				Enabled:            true,
				Sampler:            0.5,
				ParentBasedSampler: true,
				Exporters: []*ExporterConfig{
					{Endpoint: all.url},
					{Endpoint: higher.url, SamplingRate: new(0.8)},
					{Endpoint: lower.url, SamplingRate: new(0.05)},
					{Endpoint: disabled.url, Disabled: true},
				},
			},
		})
		require.NoError(t, err)

		traceIDs := startTraces(t.Context(), tp.Tracer("test"), 500, false)
		require.NoError(t, tp.Shutdown(t.Context()))

		assert.Equal(t, sampledTraces(traceIDs, 0.5), all.traces())
		assert.Equal(t, sampledTraces(traceIDs, 0.5), higher.traces())
		assert.Equal(t, sampledTraces(traceIDs, 0.05), lower.traces())
		assert.Empty(t, disabled.traces())
	})

	t.Run("exporters apply their rate to traces sampled upstream", func(t *testing.T) {
		t.Parallel()

		all := newOTLPCollector(t)
		higher := newOTLPCollector(t)
		lower := newOTLPCollector(t)

		tp, err := NewTracerProvider(t.Context(), &ProviderConfig{
			Logger: zap.NewNop(),
			Config: &Config{
				Enabled:            true,
				Sampler:            0.5,
				ParentBasedSampler: true,
				Exporters: []*ExporterConfig{
					{Endpoint: all.url},
					{Endpoint: higher.url, SamplingRate: new(0.8)},
					{Endpoint: lower.url, SamplingRate: new(0.05)},
				},
			},
		})
		require.NoError(t, err)

		traceIDs := startTraces(t.Context(), tp.Tracer("test"), 500, true)
		require.NoError(t, tp.Shutdown(t.Context()))

		// The parent-based sampler records every trace, regardless of the global rate.
		assert.Equal(t, sampledTraces(traceIDs, 1), all.traces())
		assert.Equal(t, sampledTraces(traceIDs, 0.8), higher.traces())
		assert.Equal(t, sampledTraces(traceIDs, 0.05), lower.traces())
	})
}

// startTraces starts n traces with a root and a child span each and returns
// their trace IDs. When sampledUpstream is set, every root has a sampled
// remote parent of its own trace.
func startTraces(ctx context.Context, tracer oteltrace.Tracer, n int, sampledUpstream bool) []oteltrace.TraceID {
	traceIDs := make([]oteltrace.TraceID, 0, n)
	for range n {
		parent := ctx
		if sampledUpstream {
			parent = withSampledRemoteParent(ctx)
		}
		rootCtx, root := tracer.Start(parent, "root")
		_, child := tracer.Start(rootCtx, "child")
		child.End()
		root.End()
		traceIDs = append(traceIDs, root.SpanContext().TraceID())
	}
	return traceIDs
}

// withSampledRemoteParent returns a copy of ctx carrying a sampled remote span
// of a new random trace, as if an upstream service had sampled the request.
func withSampledRemoteParent(ctx context.Context) context.Context {
	var traceID oteltrace.TraceID
	var spanID oteltrace.SpanID
	_, _ = rand.Read(traceID[:])
	_, _ = rand.Read(spanID[:])
	return oteltrace.ContextWithRemoteSpanContext(ctx, oteltrace.NewSpanContext(oteltrace.SpanContextConfig{
		TraceID:    traceID,
		SpanID:     spanID,
		TraceFlags: oteltrace.FlagsSampled,
		Remote:     true,
	}))
}

// sampledTraces returns the traces of traceIDs that a trace ID ratio sampler
// selects at rate, with the two spans started per trace by startTraces.
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
