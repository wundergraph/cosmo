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
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/protobuf/proto"
)

func TestExporterSamplingRate(t *testing.T) {
	t.Parallel()

	cfg := &Config{Sampler: 0.5}

	assert.Equal(t, 0.5, ExporterSamplingRate(cfg, &ExporterConfig{}))
	assert.Equal(t, 0.1, ExporterSamplingRate(cfg, &ExporterConfig{SamplingRate: new(0.1)}))
	assert.Equal(t, 0.0, ExporterSamplingRate(cfg, &ExporterConfig{SamplingRate: new(0.0)}))
	assert.Equal(t, 0.5, ExporterSamplingRate(cfg, &ExporterConfig{SamplingRate: new(1.0)}))
}

func TestHeadSamplingRate(t *testing.T) {
	t.Parallel()

	t.Run("no exporters keeps the global rate", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, 0.5, HeadSamplingRate(&Config{Sampler: 0.5}))
	})

	t.Run("an exporter inheriting the global rate keeps it", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, 1.0, HeadSamplingRate(&Config{
			Sampler: 1,
			Exporters: []*ExporterConfig{
				{},
				{SamplingRate: new(0.01)},
			},
		}))
	})

	t.Run("lowered to the highest exporter rate", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, 0.2, HeadSamplingRate(&Config{
			Sampler: 1,
			Exporters: []*ExporterConfig{
				{SamplingRate: new(0.2)},
				{SamplingRate: new(0.01)},
			},
		}))
	})

	t.Run("capped at the global rate", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, 0.01, HeadSamplingRate(&Config{
			Sampler: 0.01,
			Exporters: []*ExporterConfig{
				{},
				{SamplingRate: new(1.0)},
			},
		}))
	})

	t.Run("disabled exporters are ignored", func(t *testing.T) {
		t.Parallel()
		assert.Equal(t, 0.01, HeadSamplingRate(&Config{
			Sampler: 1,
			Exporters: []*ExporterConfig{
				{Disabled: true},
				{SamplingRate: new(0.01)},
			},
		}))
		assert.Equal(t, 0.1, HeadSamplingRate(&Config{
			Sampler: 0.1,
			Exporters: []*ExporterConfig{
				{Disabled: true, SamplingRate: new(1.0)},
				{},
			},
		}))
	})
}

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

	traceIDs := startTraces(tp.Tracer("test"), context.Background, 1000)

	assert.Equal(t, sampledTraces(traceIDs, 0.5), spansPerTrace(high))
	assert.Equal(t, sampledTraces(traceIDs, 0.1), spansPerTrace(low))
	assert.Empty(t, none.GetSpans())
}

func TestNewTracerProviderExporterSamplingRates(t *testing.T) {
	t.Parallel()

	t.Run("exporters receive the traces selected by their rate", func(t *testing.T) {
		t.Parallel()

		inherits := newOTLPCollector(t)
		capped := newOTLPCollector(t)
		lower := newOTLPCollector(t)
		disabled := newOTLPCollector(t)

		core, logs := observer.New(zap.WarnLevel)
		tp, err := NewTracerProvider(context.Background(), &ProviderConfig{
			Logger: zap.New(core),
			Config: &Config{
				Enabled:            true,
				Sampler:            0.5,
				ParentBasedSampler: true,
				Exporters: []*ExporterConfig{
					{Endpoint: inherits.url},
					{Endpoint: capped.url, SamplingRate: new(1.0)},
					{Endpoint: lower.url, SamplingRate: new(0.05)},
					{Endpoint: disabled.url, SamplingRate: new(1.0), Disabled: true},
				},
			},
		})
		require.NoError(t, err)

		traceIDs := startTraces(tp.Tracer("test"), context.Background, 500)
		require.NoError(t, tp.Shutdown(context.Background()))

		assert.Equal(t, sampledTraces(traceIDs, 0.5), inherits.traces())
		// The global rate caps the exporter rate above it, with a warning.
		assert.Equal(t, sampledTraces(traceIDs, 0.5), capped.traces())
		assert.Equal(t, 1, logs.FilterField(zap.String("endpoint", capped.url)).Len())
		assert.Equal(t, sampledTraces(traceIDs, 0.05), lower.traces())
		assert.Empty(t, disabled.traces())
	})

	t.Run("exporters below the global rate filter traces sampled upstream", func(t *testing.T) {
		t.Parallel()

		highest := newOTLPCollector(t)
		lower := newOTLPCollector(t)

		tp, err := NewTracerProvider(context.Background(), &ProviderConfig{
			Logger: zap.NewNop(),
			Config: &Config{
				Enabled:            true,
				Sampler:            0.5,
				ParentBasedSampler: true,
				Exporters: []*ExporterConfig{
					{Endpoint: highest.url, SamplingRate: new(0.2)},
					{Endpoint: lower.url, SamplingRate: new(0.05)},
				},
			},
		})
		require.NoError(t, err)

		traceIDs := startTraces(tp.Tracer("test"), sampledRemoteParent, 500)
		require.NoError(t, tp.Shutdown(context.Background()))

		// The parent-based sampler records every trace, and every exporter
		// applies its own rate to them, including the one with the highest rate.
		assert.Equal(t, sampledTraces(traceIDs, 0.2), highest.traces())
		assert.Equal(t, sampledTraces(traceIDs, 0.05), lower.traces())
	})
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

// sampledRemoteParent returns a context carrying a sampled remote span of a
// new random trace, as if an upstream service had sampled the request.
func sampledRemoteParent() context.Context {
	var traceID oteltrace.TraceID
	var spanID oteltrace.SpanID
	_, _ = rand.Read(traceID[:])
	_, _ = rand.Read(spanID[:])
	return oteltrace.ContextWithRemoteSpanContext(context.Background(), oteltrace.NewSpanContext(oteltrace.SpanContextConfig{
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
