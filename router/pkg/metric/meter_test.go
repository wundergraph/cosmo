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
	selector := getTemporalitySelector("", log)
	assert.Equal(t, selector(sdkmetric.InstrumentKindCounter), defaultCLoudTemporalitySelector(sdkmetric.InstrumentKindCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindUpDownCounter), defaultCLoudTemporalitySelector(sdkmetric.InstrumentKindUpDownCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindHistogram), defaultCLoudTemporalitySelector(sdkmetric.InstrumentKindHistogram))
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableCounter), defaultCLoudTemporalitySelector(sdkmetric.InstrumentKindObservableCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableUpDownCounter), defaultCLoudTemporalitySelector(sdkmetric.InstrumentKindObservableUpDownCounter))
	assert.Equal(t, selector(sdkmetric.InstrumentKindObservableGauge), defaultCLoudTemporalitySelector(sdkmetric.InstrumentKindObservableGauge))

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
}
