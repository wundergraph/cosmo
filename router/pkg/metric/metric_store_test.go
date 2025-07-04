package metric

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	otelmetric "go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// TestCardinalityLimit tests the cardinality limit of the data points.
// This test cannot be run in parallel with other tests as OTEL currently requires an environment variable,
// to enable the feature for cardinality limit. Other OTEL implementations already include cardinality limits in their
// basic API.
// Once the OTEL-go SDK includes this feature in the basic API, this test needs to be updated accordingly.
func TestCardinalityLimit(t *testing.T) {
	a := attribute.Key("testKey")

	t.Run("Should limit cardinality of data points to a max of 10", func(t *testing.T) {
		t.Cleanup(func() {
			require.NoError(t, os.Unsetenv("OTEL_GO_X_CARDINALITY_LIMIT"))
		})

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 10, metricReader)

		for i := 0; i < 30; i++ {
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
		t.Cleanup(func() {
			require.NoError(t, os.Unsetenv("OTEL_GO_X_CARDINALITY_LIMIT"))
		})

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 0, metricReader)

		for i := 0; i < 30; i++ {
			store.MeasureLatency(context.Background(), time.Second, nil,
				otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("testValue%d", i)))),
			)
		}

		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(context.Background(), &rm)
		require.NoError(t, err)

		histogram, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
		require.True(t, ok)

		// Without a limit we expect all 30 data points
		require.Len(t, histogram.DataPoints, 30)
	})

	t.Run("Should not allow negative cardinality limit and use default cardinality limit", func(t *testing.T) {
		t.Cleanup(func() {
			require.NoError(t, os.Unsetenv("OTEL_GO_X_CARDINALITY_LIMIT"))
		})

		metricReader := metric.NewManualReader()
		store := createTestStore(t, -1, metricReader)

		// We attempt to create more data points than the default cardinality limit
		for i := 0; i < 2*DefaultCardinalityLimit; i++ {
			store.MeasureLatency(context.Background(), time.Second, nil, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("testValue%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(context.Background(), &rm)
		require.NoError(t, err)

		histogram, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
		require.True(t, ok)

		// A negative limit should default to 0 which means that no limit is applied.
		require.Len(t, histogram.DataPoints, DefaultCardinalityLimit)
	})

	t.Run("Should not allow disabling cardinality limit and use default cardinality limit", func(t *testing.T) {
		t.Cleanup(func() {
			require.NoError(t, os.Unsetenv("OTEL_GO_X_CARDINALITY_LIMIT"))
		})

		metricReader := metric.NewManualReader()
		store := createTestStore(t, 0, metricReader)

		// We attempt to create more data points than the default cardinality limit
		for i := 0; i < 2*DefaultCardinalityLimit; i++ {
			store.MeasureLatency(context.Background(), time.Second, nil, otelmetric.WithAttributeSet(attribute.NewSet(a.String(fmt.Sprintf("testValue%d", i)))))
		}

		var rm metricdata.ResourceMetrics
		err := metricReader.Collect(context.Background(), &rm)
		require.NoError(t, err)

		histogram, ok := rm.ScopeMetrics[0].Metrics[0].Data.(metricdata.Histogram[float64])
		require.True(t, ok)

		// A negative limit should default to 0 which means that no limit is applied.
		require.Len(t, histogram.DataPoints, DefaultCardinalityLimit)
	})
}

func createTestStore(t *testing.T, limit int, metricReader *metric.ManualReader) Store {
	mp := metric.NewMeterProvider(metric.WithReader(metricReader))
	promExporter, err := otelprom.New(
		otelprom.WithRegisterer(prometheus.NewRegistry()),
		otelprom.WithoutUnits())

	require.NoError(t, err)

	prom := metric.NewMeterProvider(metric.WithReader(promExporter))

	opts := MetricOpts{
		EnableCircuitBreaker: true,
	}
	store, err := NewStore(opts, opts,
		WithCardinalityLimit(limit),
		WithOtlpMeterProvider(mp),
		WithPromMeterProvider(prom),
		WithRouterInfoAttributes(otelmetric.WithAttributeSet(attribute.NewSet())),
	)

	require.NoError(t, err)

	return store
}
