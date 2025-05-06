package metric

import (
	"github.com/stretchr/testify/assert"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap"
	"testing"
)

func TestGetTemporalitySelector(t *testing.T) {
	log := zap.NewNop()
	selector := getTemporalitySelector(otelconfig.CustomCloudTemporality, log)
	assert.Equal(t, selector(sdkmetric.InstrumentKindCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindUpDownCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindHistogram), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindHistogram))
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableUpDownCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableGauge), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableGauge))

	selector = getTemporalitySelector(otelconfig.DeltaTemporality, log)
	assert.Equal(t, selector(sdkmetric.InstrumentKindCounter), metricdata.DeltaTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableCounter), metricdata.DeltaTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindHistogram), metricdata.DeltaTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindGauge), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableGauge), metricdata.CumulativeTemporality)

	selector = getTemporalitySelector(otelconfig.CumulativeTemporality, log)
	assert.Equal(t, selector(sdkmetric.InstrumentKindCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindHistogram), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindGauge), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableGauge), metricdata.CumulativeTemporality)

	selector = getTemporalitySelector("", log)
	assert.Equal(t, selector(sdkmetric.InstrumentKindCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindHistogram), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindGauge), metricdata.CumulativeTemporality)
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableGauge), metricdata.CumulativeTemporality)
}

func TestCreateOTELExporter(t *testing.T) {
	log := zap.NewNop()
	// if the temporality is not configured, it should fall back to cumulative(that's the default).
	exporterConfig := &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    "http://a.com",
		Headers:     nil,
		HTTPPath:    "",
		Temporality: "",
	}
	exporter, err := createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindGauge), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), metricdata.CumulativeTemporality)

	exporterConfig = &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    "http://a.com",
		Headers:     nil,
		HTTPPath:    "",
		Temporality: otelconfig.CumulativeTemporality,
	}
	exporter, err = createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindGauge), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), metricdata.CumulativeTemporality)

	exporterConfig = &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    "http://a.com",
		Headers:     nil,
		HTTPPath:    "",
		Temporality: otelconfig.DeltaTemporality,
	}
	exporter, err = createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), metricdata.DeltaTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), metricdata.DeltaTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), metricdata.DeltaTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindGauge), metricdata.CumulativeTemporality)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), metricdata.CumulativeTemporality)

	// check if the endpoint is the default cloud otel endpoint, the temporality selector
	// fallback to the custom temporality selector irrespective of what is configured
	exporterConfig = &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    otelconfig.DefaultEndpoint(),
		Headers:     nil,
		HTTPPath:    "",
		Temporality: otelconfig.DeltaTemporality,
	}
	exporter, err = createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindHistogram))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableGauge))

	exporterConfig = &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    otelconfig.DefaultEndpoint(),
		Headers:     nil,
		HTTPPath:    "",
		Temporality: otelconfig.CumulativeTemporality,
	}
	exporter, err = createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindHistogram))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableGauge))

	exporterConfig = &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    otelconfig.DefaultEndpoint(),
		Headers:     nil,
		HTTPPath:    "",
		Temporality: otelconfig.CustomCloudTemporality,
	}
	exporter, err = createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindHistogram))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableGauge))

	exporterConfig = &OpenTelemetryExporter{
		Disabled:    false,
		Exporter:    "http",
		Endpoint:    otelconfig.DefaultEndpoint(),
		Headers:     nil,
		HTTPPath:    "",
		Temporality: "",
	}
	exporter, err = createOTELExporter(log, exporterConfig)
	assert.NoError(t, err)
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindHistogram), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindHistogram))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableUpDownCounter), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableUpDownCounter))
	assert.Equal(t, exporter.Temporality(sdkmetric.InstrumentKindObservableGauge), defaultCloudTemporalitySelector(sdkmetric.InstrumentKindObservableGauge))
}
