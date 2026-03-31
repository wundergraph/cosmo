package metric

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/otlptranslator"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"go.opentelemetry.io/otel/attribute"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.uber.org/zap"
)

// TestCardinalityLimit tests the cardinality limit of the data points
// using the SDK's WithCardinalityLimit option.
func TestCardinalityLimit(t *testing.T) {
	t.Parallel()

	a := attribute.Key("testKey")

	t.Run("Should limit cardinality of data points to a max of 10", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 10, metricReader)

		for i := range 30 {
			store.MeasureLatency(context.Background(), time.Second, nil, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("testValue%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(context.Background(), &rm)
		require.NoError(t, err)

		histogram, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
		require.True(t, ok)

		// With a limit of 10 out of 30 different possible data points we expect a maximum of 10
		require.Len(t, histogram.DataPoints, 10)
	})

	t.Run("Should not limit cardinality of data points when 0 is provided", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 0, metricReader)

		for i := range 30 {
			store.MeasureLatency(context.Background(), time.Second, nil,
				otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("testValue%d", i)))),
			)
		}

		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(context.Background(), &rm)
		require.NoError(t, err)

		histogram, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
		require.True(t, ok)

		// A limit of 0 means no limit is applied, so we expect all 30 data points
		require.Len(t, histogram.DataPoints, 30)
	})

	t.Run("Should treat negative cardinality limit as unlimited", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		store := createTestStore(t, -1, metricReader)

		for i := range 30 {
			store.MeasureLatency(context.Background(), time.Second, nil, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("testValue%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(context.Background(), &rm)
		require.NoError(t, err)

		histogram, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
		require.True(t, ok)

		// A negative limit means no limit is applied, so we expect all 30 data points
		require.Len(t, histogram.DataPoints, 30)
	})
}

// TestOtlpMeterProviderCardinalityLimit tests that NewOtlpMeterProvider applies
// the cardinality limit from the Config, including clamping <= 0 to DefaultCardinalityLimit.
func TestOtlpMeterProviderCardinalityLimit(t *testing.T) {
	t.Parallel()

	a := attribute.Key("testKey")

	t.Run("explicit limit is applied", func(t *testing.T) {
		t.Parallel()

		reader := metric.NewManualReader()
		cfg := testOtlpConfig(reader, 10)

		mp, err := NewOtlpMeterProvider(context.Background(), zap.NewNop(), cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		counter, err := mp.Meter("test").Int64Counter("test.counter")
		require.NoError(t, err)

		for i := range 30 {
			counter.Add(context.Background(), 1, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("v%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(context.Background(), &rm))

		dp := findMetricDataPoints(t, rm, "test.counter")
		require.Len(t, dp, 10)
	})

	t.Run("zero limit is clamped to DefaultCardinalityLimit", func(t *testing.T) {
		t.Parallel()

		reader := metric.NewManualReader()
		cfg := testOtlpConfig(reader, 0)

		mp, err := NewOtlpMeterProvider(context.Background(), zap.NewNop(), cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		counter, err := mp.Meter("test").Int64Counter("test.counter")
		require.NoError(t, err)

		// Create more data points than DefaultCardinalityLimit
		for i := range DefaultCardinalityLimit + 500 {
			counter.Add(context.Background(), 1, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("v%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(context.Background(), &rm))

		dp := findMetricDataPoints(t, rm, "test.counter")
		require.Len(t, dp, DefaultCardinalityLimit)
	})

	t.Run("negative limit is clamped to DefaultCardinalityLimit", func(t *testing.T) {
		t.Parallel()

		reader := metric.NewManualReader()
		cfg := testOtlpConfig(reader, -1)

		mp, err := NewOtlpMeterProvider(context.Background(), zap.NewNop(), cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		counter, err := mp.Meter("test").Int64Counter("test.counter")
		require.NoError(t, err)

		for i := range DefaultCardinalityLimit + 500 {
			counter.Add(context.Background(), 1, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("v%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		require.NoError(t, reader.Collect(context.Background(), &rm))

		dp := findMetricDataPoints(t, rm, "test.counter")
		require.Len(t, dp, DefaultCardinalityLimit)
	})
}

// TestPrometheusMeterProviderCardinalityLimit tests that NewPrometheusMeterProvider applies
// the cardinality limit from the Config, including clamping <= 0 to DefaultCardinalityLimit.
func TestPrometheusMeterProviderCardinalityLimit(t *testing.T) {
	t.Parallel()

	a := attribute.Key("testKey")

	t.Run("explicit limit is applied", func(t *testing.T) {
		t.Parallel()

		cfg := testPrometheusConfig(10)

		mp, registry, err := NewPrometheusMeterProvider(context.Background(), cfg, "test-instance")
		require.NoError(t, err)
		require.NotNil(t, registry)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		counter, err := mp.Meter("test").Int64Counter("test.counter")
		require.NoError(t, err)

		for i := range 30 {
			counter.Add(context.Background(), 1, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("v%d", i)))))
		}

		count := gatherMetricCount(t, registry, "test_counter_total")
		require.Equal(t, 10, count)
	})

	t.Run("zero limit is clamped to DefaultCardinalityLimit", func(t *testing.T) {
		t.Parallel()

		cfg := testPrometheusConfig(0)

		mp, registry, err := NewPrometheusMeterProvider(context.Background(), cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		counter, err := mp.Meter("test").Int64Counter("test.counter")
		require.NoError(t, err)

		for i := range DefaultCardinalityLimit + 500 {
			counter.Add(context.Background(), 1, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("v%d", i)))))
		}

		count := gatherMetricCount(t, registry, "test_counter_total")
		require.Equal(t, DefaultCardinalityLimit, count)
	})

	t.Run("negative limit is clamped to DefaultCardinalityLimit", func(t *testing.T) {
		t.Parallel()

		cfg := testPrometheusConfig(-1)

		mp, registry, err := NewPrometheusMeterProvider(context.Background(), cfg, "test-instance")
		require.NoError(t, err)
		t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

		counter, err := mp.Meter("test").Int64Counter("test.counter")
		require.NoError(t, err)

		for i := range DefaultCardinalityLimit + 500 {
			counter.Add(context.Background(), 1, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("v%d", i)))))
		}

		count := gatherMetricCount(t, registry, "test_counter_total")
		require.Equal(t, DefaultCardinalityLimit, count)
	})
}

// TestOtlpScopeBasedMetricDrop verifies that metrics from the otelhttp scope
// are dropped by the view in NewOtlpMeterProvider, while metrics from other scopes pass through.
func TestOtlpScopeBasedMetricDrop(t *testing.T) {
	t.Parallel()

	reader := metric.NewManualReader()
	cfg := testOtlpConfig(reader, 0)

	mp, err := NewOtlpMeterProvider(context.Background(), zap.NewNop(), cfg, "test-instance")
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

	// Emit a metric from the otelhttp scope (should be dropped)
	blocked, err := mp.Meter(otelhttp.ScopeName).Int64Counter("http.server.request.duration")
	require.NoError(t, err)
	blocked.Add(context.Background(), 1)

	// Emit a metric with the same name from an allowed scope (should pass through)
	allowed, err := mp.Meter("cosmo.router").Int64Counter("http.server.request.duration")
	require.NoError(t, err)
	allowed.Add(context.Background(), 1)

	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))

	// Only the allowed scope's metric should be present
	var found bool
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name == "http.server.request.duration" {
				require.Equal(t, "cosmo.router", sm.Scope.Name, "metric should only come from the allowed scope")
				found = true
			}
		}
	}
	require.True(t, found, "expected metric from allowed scope")
}

// TestPrometheusScopeBasedMetricDrop verifies that metrics from the otelhttp scope
// are dropped by the view in NewPrometheusMeterProvider.
func TestPrometheusScopeBasedMetricDrop(t *testing.T) {
	t.Parallel()

	cfg := testPrometheusConfig(0)

	mp, registry, err := NewPrometheusMeterProvider(context.Background(), cfg, "test-instance")
	require.NoError(t, err)
	require.NotNil(t, registry)
	t.Cleanup(func() { require.NoError(t, mp.Shutdown(context.Background())) })

	// Emit a metric from the otelhttp scope (should be dropped)
	blocked, err := mp.Meter(otelhttp.ScopeName).Int64Counter("test.blocked.counter")
	require.NoError(t, err)
	blocked.Add(context.Background(), 1)

	// Emit a metric from an allowed scope (should pass through)
	allowed, err := mp.Meter("cosmo.router").Int64Counter("test.allowed.counter")
	require.NoError(t, err)
	allowed.Add(context.Background(), 1)

	mf, err := registry.Gather()
	require.NoError(t, err)

	var foundAllowed, foundBlocked bool
	for _, f := range mf {
		if f.GetName() == "test_allowed_counter_total" {
			foundAllowed = true
		}
		if f.GetName() == "test_blocked_counter_total" {
			foundBlocked = true
		}
	}
	require.True(t, foundAllowed, "metric from allowed scope should be present")
	require.False(t, foundBlocked, "metric from otelhttp scope should be dropped")
}

// --- helpers ---

func createTestStore(t *testing.T, limit int, metricReader *metric.ManualReader) Store {
	t.Helper()

	mp := metric.NewMeterProvider(
		metric.WithReader(metricReader),
		metric.WithCardinalityLimit(limit),
	)
	promExporter, err := otelprom.New(
		otelprom.WithRegisterer(prometheus.NewRegistry()),
		otelprom.WithTranslationStrategy(otlptranslator.UnderscoreEscapingWithSuffixes),
	)

	require.NoError(t, err)

	prom := metric.NewMeterProvider(
		metric.WithReader(promExporter),
		metric.WithCardinalityLimit(limit),
	)

	opts := MetricOpts{
		EnableCircuitBreaker: true,
		CostStats: config.CostStats{
			EstimatedEnabled: true,
			ActualEnabled:    true,
		},
	}

	store, err := NewStore(opts, opts,
		WithOtlpMeterProvider(mp),
		WithPromMeterProvider(prom),
		WithRouterInfoAttributes(otelmetric.WithAttributeSet(attribute.NewSet())),
	)

	require.NoError(t, err)

	return store
}

// testOtlpConfig returns a minimal Config for NewOtlpMeterProvider with a test reader.
func testOtlpConfig(reader *metric.ManualReader, cardinalityLimit int) *Config {
	return &Config{
		Name:             "test",
		Version:          "dev",
		CardinalityLimit: cardinalityLimit,
		OpenTelemetry: OpenTelemetry{
			Enabled:    true,
			TestReader: reader,
		},
	}
}

// testPrometheusConfig returns a minimal Config for NewPrometheusMeterProvider with a test registry.
func testPrometheusConfig(cardinalityLimit int) *Config {
	return &Config{
		Name:             "test",
		Version:          "dev",
		CardinalityLimit: cardinalityLimit,
		Prometheus: PrometheusConfig{
			Enabled:      true,
			TestRegistry: prometheus.NewRegistry(),
		},
	}
}

// gatherMetricCount gathers metrics from the registry and returns the number
// of metric series for the given metric name.
func gatherMetricCount(t *testing.T, registry *prometheus.Registry, name string) int {
	t.Helper()
	mf, err := registry.Gather()
	require.NoError(t, err)
	for _, f := range mf {
		if f.GetName() == name {
			return len(f.GetMetric())
		}
	}
	t.Fatalf("metric %q not found in registry", name)
	return 0
}

// findMetricDataPoints locates a metric by name and returns its data points.
func findMetricDataPoints(t *testing.T, rm metricdata.ResourceMetrics, name string) []metricdata.DataPoint[int64] {
	t.Helper()
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			if m.Name == name {
				if sum, ok := m.Data.(metricdata.Sum[int64]); ok {
					return sum.DataPoints
				}
				t.Fatalf("metric %q has unexpected data type %T", name, m.Data)
			}
		}
	}
	t.Fatalf("metric %q not found", name)
	return nil
}

// TestOperationCostMetrics tests that operation cost metrics are recorded correctly
func TestOperationCostMetrics(t *testing.T) {
	t.Parallel()

	t.Run("Should record estimated, actual costs metrics", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 0, metricReader)

		ctx := context.Background()
		attrs := []attribute.KeyValue{
			attribute.String("operation_name", "MyQuery"),
			attribute.String("operation_type", "query"),
		}
		opt := otelmetric.WithAttributeSet(attribute.NewSet(attrs...))

		// Record cost metrics
		store.MeasureOperationCostEstimated(ctx, 100, attrs, opt)
		store.MeasureOperationCostActual(ctx, 150, attrs, opt)

		// Collect metrics
		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(ctx, &rm)
		require.NoError(t, err)

		// Verify we have metrics
		require.NotEmpty(t, rm.ScopeMetrics)
		require.NotEmpty(t, rm.ScopeMetrics[0].Metrics)

		// Find our cost metrics
		var estimatedHistogram, actualHistogram metricdata.Histogram[int64]
		var foundEstimated, foundActual bool

		for _, m := range rm.ScopeMetrics[0].Metrics {
			switch m.Name {
			case OperationCostEstimatedHistogram:
				estimatedHistogram, foundEstimated = m.Data.(metricdata.Histogram[int64])
			case OperationCostActualHistogram:
				actualHistogram, foundActual = m.Data.(metricdata.Histogram[int64])
			}
		}

		// Verify metrics were found and are Int64 histograms
		require.True(t, foundEstimated, "estimated cost metric not found")
		require.True(t, foundActual, "actual cost metric not found")

		// Verify data points exist
		require.Len(t, estimatedHistogram.DataPoints, 1)
		require.Len(t, actualHistogram.DataPoints, 1)

		// Verify the recorded values
		require.Equal(t, uint64(1), estimatedHistogram.DataPoints[0].Count)
		require.Equal(t, int64(100), estimatedHistogram.DataPoints[0].Sum)

		require.Equal(t, uint64(1), actualHistogram.DataPoints[0].Count)
		require.Equal(t, int64(150), actualHistogram.DataPoints[0].Sum)
	})

	t.Run("Should aggregate multiple cost measurements", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 0, metricReader)

		ctx := context.Background()
		attrs := []attribute.KeyValue{
			attribute.String("operation_name", "MyQuery"),
		}
		opt := otelmetric.WithAttributeSet(attribute.NewSet(attrs...))

		// Record multiple measurements
		store.MeasureOperationCostEstimated(ctx, 100, attrs, opt)
		store.MeasureOperationCostEstimated(ctx, 200, attrs, opt)
		store.MeasureOperationCostEstimated(ctx, 300, attrs, opt)

		// Collect metrics
		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(ctx, &rm)
		require.NoError(t, err)

		// Find estimated metric
		var estimatedHistogram metricdata.Histogram[int64]
		var foundEstimated bool

		for _, m := range rm.ScopeMetrics[0].Metrics {
			if m.Name == OperationCostEstimatedHistogram {
				estimatedHistogram, foundEstimated = m.Data.(metricdata.Histogram[int64])
				break
			}
		}

		require.True(t, foundEstimated)
		require.Len(t, estimatedHistogram.DataPoints, 1)
		require.Equal(t, uint64(3), estimatedHistogram.DataPoints[0].Count)
		require.Equal(t, int64(600), estimatedHistogram.DataPoints[0].Sum) // 100 + 200 + 300
	})
}
