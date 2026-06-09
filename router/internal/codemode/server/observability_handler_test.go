package server

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	yokov1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/code_mode/yoko/v1"
	"github.com/wundergraph/cosmo/router/internal/codemode/harness"
	"github.com/wundergraph/cosmo/router/internal/codemode/sandbox"
	"github.com/wundergraph/cosmo/router/internal/codemode/storage"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

func TestHandleSearchRecordsObservability(t *testing.T) {
	traces, meterProvider, reader := newHandlerTelemetry()
	searcher := newFakeYoko()
	searcher.responses <- &yokov1.SearchResponse{Operations: []*yokov1.GeneratedOperation{{
		Name: "getOrders",
		Body: "query GetOrders { orders { id } }",
		Kind: yokov1.OperationKind_OPERATION_KIND_QUERY,
	}}}
	store := newSearchTestStorage(t)
	srv, err := New(Config{
		CodeModeEnabled: true,
		NamedOpsEnabled: true,
		Storage:         store,
		YokoClient:      searcher,
		Logger:          zap.NewNop(),
		TracerProvider:  sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(traces)),
		MeterProvider:   meterProvider,
	})
	require.NoError(t, err)

	got, err := srv.handleSearch(context.Background(), searchToolRequest(t, "session-1", map[string]any{
		"prompts": []string{"orders"},
	}))

	require.NoError(t, err)
	require.False(t, got.IsError)
	assert.Equal(t, []tracetest.SpanStub{{
		Name:     "MCP Code Mode - Search",
		SpanKind: trace.SpanKindServer,
		Attributes: []attribute.KeyValue{
			attribute.String("mcp.tool", "code_mode_search_tools"),
			attribute.String("mcp.status", "success"),
		},
		InstrumentationLibrary: normalizedSpanStubs(traces.Ended())[0].InstrumentationLibrary,
	}}, normalizedSpanStubs(traces.Ended()))
	assertCodeModeMetric(t, reader, "code_mode_search_tools", "success")
}

func TestHandleExecuteRecordsObservability(t *testing.T) {
	traces, meterProvider, reader := newHandlerTelemetry()
	store := newExecuteTestStorage()
	store.ops["session-1"] = []storage.SessionOp{{
		Name: "someName",
		Body: "query SomeName { orders { id total } }",
		Kind: storage.OperationKindQuery,
	}}
	pipeline := &recordingPipeline{
		response: pipelineResponse(t, harness.ResultEnvelope{
			Result:    json.RawMessage(`{"orders":[{"id":"o1"}]}`),
			Truncated: false,
			Error:     nil,
		}),
	}
	srv := newExecuteTestServer(t, Config{
		CodeModeEnabled:  true,
		NamedOpsEnabled:  true,
		SessionStateless: false,
		Pipeline:         pipeline,
		ApprovalGate:     sandbox.AutoApprove,
		Logger:           zap.NewNop(),
		TracerProvider:   sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(traces)),
		MeterProvider:    meterProvider,
	}, store)

	got, err := srv.handleExecute(context.Background(), executeToolRequest(t, "session-1", map[string]any{
		"source": "async () => tools.someName({})",
	}))

	require.NoError(t, err)
	require.False(t, got.IsError)
	assert.Equal(t, []tracetest.SpanStub{{
		Name:     "MCP Code Mode - Execute",
		SpanKind: trace.SpanKindServer,
		Attributes: []attribute.KeyValue{
			attribute.String("mcp.tool", "code_mode_run_js"),
			attribute.String("mcp.status", "success"),
		},
		InstrumentationLibrary: normalizedSpanStubs(traces.Ended())[0].InstrumentationLibrary,
	}}, normalizedSpanStubs(traces.Ended()))
	assertCodeModeMetric(t, reader, "code_mode_run_js", "success")
	require.True(t, pipeline.lastSpanContext().IsValid())
}

func newHandlerTelemetry() (*tracetest.SpanRecorder, *sdkmetric.MeterProvider, *sdkmetric.ManualReader) {
	reader := sdkmetric.NewManualReader()
	return tracetest.NewSpanRecorder(), sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)), reader
}

func normalizedSpanStubs(spans []sdktrace.ReadOnlySpan) []tracetest.SpanStub {
	stubs := make([]tracetest.SpanStub, 0, len(spans))
	for _, span := range spans {
		stub := tracetest.SpanStubFromReadOnlySpan(span)
		stub.SpanContext = trace.SpanContext{}
		stub.StartTime = time.Time{}
		stub.EndTime = time.Time{}
		stub.Resource = nil
		stubs = append(stubs, stub)
	}
	return stubs
}

func assertCodeModeMetric(t *testing.T, reader *sdkmetric.ManualReader, toolName string, status string) {
	t.Helper()
	var got metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &got))

	counter, histogram := handlerCodeModeMetrics(t, got)
	counterData, ok := counter.Data.(metricdata.Sum[int64])
	require.True(t, ok)
	require.Len(t, counterData.DataPoints, 1)
	counterPoint := counterData.DataPoints[0]
	counterPoint.StartTime = time.Time{}
	counterPoint.Time = time.Time{}
	assert.Equal(t, metricdata.DataPoint[int64]{
		Attributes: attribute.NewSet(
			attribute.String("mcp.tool", toolName),
			attribute.String("mcp.status", status),
		),
		Value: 1,
	}, counterPoint)

	histogramData, ok := histogram.Data.(metricdata.Histogram[float64])
	require.True(t, ok)
	require.Len(t, histogramData.DataPoints, 1)
	histogramPoint := histogramData.DataPoints[0]
	require.Greater(t, histogramPoint.Sum, 0.0)
	histogramPoint.StartTime = time.Time{}
	histogramPoint.Time = time.Time{}
	assert.Equal(t, metricdata.HistogramDataPoint[float64]{
		Attributes: attribute.NewSet(
			attribute.String("mcp.tool", toolName),
			attribute.String("mcp.status", status),
		),
		Count:        1,
		Bounds:       histogramPoint.Bounds,
		BucketCounts: histogramPoint.BucketCounts,
		Min:          histogramPoint.Min,
		Max:          histogramPoint.Max,
		Sum:          histogramPoint.Sum,
	}, histogramPoint)
}

func handlerCodeModeMetrics(t *testing.T, metrics metricdata.ResourceMetrics) (metricdata.Metrics, metricdata.Metrics) {
	t.Helper()
	require.Len(t, metrics.ScopeMetrics, 1)
	assert.Equal(t, "wundergraph.cosmo.router.mcp.code_mode", metrics.ScopeMetrics[0].Scope.Name)

	byName := make(map[string]metricdata.Metrics, len(metrics.ScopeMetrics[0].Metrics))
	for _, metric := range metrics.ScopeMetrics[0].Metrics {
		byName[metric.Name] = metric
	}
	counter, ok := byName["mcp.code_mode.sandbox.executions"]
	require.True(t, ok)
	histogram, ok := byName["mcp.code_mode.sandbox.duration"]
	require.True(t, ok)
	return counter, histogram
}
