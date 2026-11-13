package grpcremote

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// newTestMetrics returns a grpcClientMetrics backed by a manual reader so the
// test can collect and inspect recorded data points, plus an observed logger.
func newTestMetrics(t *testing.T) (*grpcClientMetrics, *sdkmetric.ManualReader, *observer.ObservedLogs) {
	t.Helper()

	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { _ = mp.Shutdown(context.Background()) })

	core, logs := observer.New(zap.ErrorLevel)
	m, err := newGRPCClientMetrics([]metric.MeterProvider{mp}, "user-subgraph", zap.New(core))
	require.NoError(t, err)

	return m, reader, logs
}

// collectCounter returns the counter data points for the request counter.
func collectCounter(t *testing.T, reader *sdkmetric.ManualReader) []metricdata.DataPoint[int64] {
	t.Helper()

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))

	for _, sm := range rm.ScopeMetrics {
		for _, metricEntry := range sm.Metrics {
			if metricEntry.Name != requestCounterName {
				continue
			}
			sum, ok := metricEntry.Data.(metricdata.Sum[int64])
			require.True(t, ok)
			return sum.DataPoints
		}
	}
	return nil
}

func attrValue(t *testing.T, attrs attribute.Set, key string) string {
	t.Helper()
	v, ok := attrs.Value(attribute.Key(key))
	require.True(t, ok, "missing attribute %s", key)
	return v.AsString()
}

func TestMetricsUnaryClientInterceptorRecordsSuccess(t *testing.T) {
	m, reader, logs := newTestMetrics(t)
	interceptor := metricsUnaryClientInterceptor(m)

	invoker := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, opts ...grpc.CallOption) error {
		return nil
	}

	err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invoker)
	require.NoError(t, err)

	points := collectCounter(t, reader)
	require.Len(t, points, 1)
	assert.Equal(t, int64(1), points[0].Value)
	assert.Equal(t, "user-subgraph", attrValue(t, points[0].Attributes, attrSubgraphName))
	assert.Equal(t, codes.OK.String(), attrValue(t, points[0].Attributes, attrGRPCStatusCode))
	assert.Equal(t, "/service/Method", attrValue(t, points[0].Attributes, attrRPCMethod))

	assert.Zero(t, logs.Len(), "successful requests must not log errors")
}

func TestMetricsUnaryClientInterceptorRecordsTransportFailure(t *testing.T) {
	m, reader, logs := newTestMetrics(t)
	interceptor := metricsUnaryClientInterceptor(m)

	rpcErr := status.Error(codes.Unavailable, "connection refused")
	invoker := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, opts ...grpc.CallOption) error {
		return rpcErr
	}

	err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invoker)
	require.ErrorIs(t, err, rpcErr)

	points := collectCounter(t, reader)
	require.Len(t, points, 1)
	assert.Equal(t, int64(1), points[0].Value)
	assert.Equal(t, codes.Unavailable.String(), attrValue(t, points[0].Attributes, attrGRPCStatusCode))

	require.Equal(t, 1, logs.Len(), "failed requests must log at error level")
	entry := logs.All()[0]
	assert.Equal(t, "remote gRPC subgraph request failed", entry.Message)
	fields := entry.ContextMap()
	assert.Equal(t, "user-subgraph", fields["subgraph_name"])
	assert.Equal(t, codes.Unavailable.String(), fields["grpc_status_code"])
}

func TestMetricsUnaryClientInterceptorRecordsNonStatusError(t *testing.T) {
	m, reader, logs := newTestMetrics(t)
	interceptor := metricsUnaryClientInterceptor(m)

	// A non-status error (e.g. context cancellation surfaced raw) maps to
	// codes.Unknown via status.Code; it must still be counted and logged.
	invoker := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, opts ...grpc.CallOption) error {
		return errors.New("boom")
	}

	err := interceptor(context.Background(), "/service/Method", nil, nil, nil, invoker)
	require.Error(t, err)

	points := collectCounter(t, reader)
	require.Len(t, points, 1)
	assert.Equal(t, codes.Unknown.String(), attrValue(t, points[0].Attributes, attrGRPCStatusCode))
	assert.Equal(t, 1, logs.Len())
}

func TestMetricsStreamClientInterceptorRecordsCreationFailure(t *testing.T) {
	m, reader, logs := newTestMetrics(t)
	interceptor := metricsStreamClientInterceptor(m)

	streamer := func(ctx context.Context, desc *grpc.StreamDesc, cc *grpc.ClientConn, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
		return nil, status.Error(codes.DeadlineExceeded, "deadline exceeded")
	}

	_, err := interceptor(context.Background(), &grpc.StreamDesc{}, nil, "/service/Stream", streamer)
	require.Error(t, err)

	points := collectCounter(t, reader)
	require.Len(t, points, 1)
	assert.Equal(t, codes.DeadlineExceeded.String(), attrValue(t, points[0].Attributes, attrGRPCStatusCode))
	assert.Equal(t, 1, logs.Len())
}

// TestStartWiresMetricsInterceptor ensures Start succeeds when a meter
// provider is configured and fails fast on instrument-creation problems only.
func TestStartWiresMetricsInterceptor(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	t.Cleanup(func() { _ = mp.Shutdown(context.Background()) })

	provider, err := NewRemoteGRPCProvider(RemoteGRPCProviderConfig{
		Endpoint:       "localhost:5010",
		SubgraphName:   "user-subgraph",
		MeterProviders: []metric.MeterProvider{mp},
	})
	require.NoError(t, err)

	require.NoError(t, provider.Start(context.Background()))
	require.NotNil(t, provider.GetClient())
	require.NoError(t, provider.Stop())
}

// TestMetricsRecordedOnAllMeterProviders ensures that every configured meter
// provider (e.g. OTLP and Prometheus) receives the measurements, while a
// failure is logged only once.
func TestMetricsRecordedOnAllMeterProviders(t *testing.T) {
	readerA := sdkmetric.NewManualReader()
	mpA := sdkmetric.NewMeterProvider(sdkmetric.WithReader(readerA))
	readerB := sdkmetric.NewManualReader()
	mpB := sdkmetric.NewMeterProvider(sdkmetric.WithReader(readerB))
	t.Cleanup(func() {
		_ = mpA.Shutdown(context.Background())
		_ = mpB.Shutdown(context.Background())
	})

	core, logs := observer.New(zap.ErrorLevel)
	m, err := newGRPCClientMetrics([]metric.MeterProvider{mpA, mpB}, "user-subgraph", zap.New(core))
	require.NoError(t, err)

	invoker := func(ctx context.Context, method string, req, reply any, cc *grpc.ClientConn, opts ...grpc.CallOption) error {
		return status.Error(codes.Unavailable, "connection refused")
	}
	err = metricsUnaryClientInterceptor(m)(context.Background(), "/service/Method", nil, nil, nil, invoker)
	require.Error(t, err)

	for _, reader := range []*sdkmetric.ManualReader{readerA, readerB} {
		points := collectCounter(t, reader)
		require.Len(t, points, 1)
		assert.Equal(t, int64(1), points[0].Value)
		assert.Equal(t, codes.Unavailable.String(), attrValue(t, points[0].Attributes, attrGRPCStatusCode))
	}

	assert.Equal(t, 1, logs.Len(), "a failure must be logged once, not once per meter provider")
}
