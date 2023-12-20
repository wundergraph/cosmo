package metric

import (
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.uber.org/zap"
	"regexp"
	"testing"
)

func TestNameSanitizing(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{},
		[]*regexp.Regexp{},
	)

	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test2", "test2"), attribute.String("test", "test"))

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.NotEmpty(t, findMetric(metrics, "my_test_counter_total"))

	// label order should not matter

	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test", "test"), attribute.String("test2", "test2"))

	metrics, err = p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.Equal(t, findMetric(metrics, "my_test_counter_total").GetMetric()[0].GetCounter().GetValue(), float64(2))
}

func TestLabelExclusion(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{regexp.MustCompile("^test$")},
		[]*regexp.Regexp{},
	)

	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test2", "test2"), attribute.String("test", "test"))

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.Len(t, findMetric(metrics, "my_test_counter_total").GetMetric()[0].GetLabel(), 1)
	require.Equal(t, findMetric(metrics, "my_test_counter_total").GetMetric()[0].GetLabel()[0].GetName(), "test2")
}

func TestMetricExclusion(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{},
		[]*regexp.Regexp{regexp.MustCompile("^my_test_counter_total$")},
	)

	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test", "test"))
	p.AddCounter("my.test.counter2", "my test counter", 1, attribute.String("test", "test"))

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.Empty(t, findMetric(metrics, "my_test_counter_total").GetMetric())
	require.NotEmpty(t, findMetric(metrics, "my_test_counter2_total").GetMetric())
}

func TestIgnoreOperationHashAttrByDefault(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{},
		[]*regexp.Regexp{},
	)

	p.AddCounter("my.test.counter", "my test counter", 1,
		otel.WgOperationHash.String("test"),
		attribute.String("test", "test"),
	)

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.NotEmpty(t, findMetric(metrics, "my_test_counter_total"))
	require.Len(t, findMetric(metrics, "my_test_counter_total").GetMetric()[0].GetLabel(), 1)
	require.Equal(t, findMetric(metrics, "my_test_counter_total").GetMetric()[0].GetLabel()[0].GetName(), "test")
}

func TestCounter(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{},
		[]*regexp.Regexp{},
	)

	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test", "test"))
	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test", "test"))
	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test", "test"))

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.Equal(t, findMetric(metrics, "my_test_counter_total").GetMetric()[0].GetCounter().GetValue(), float64(3))

	// with unique labels values should provide unique metrics

	p.AddCounter("my.test.counter", "my test counter", 1, attribute.String("test", "test-2"))

	metrics, err = p.Registry().Gather()
	require.Nil(t, err)

	require.Len(t, findMetric(metrics, "my_test_counter_total").GetMetric(), 2)
	require.Equal(t, findMetric(metrics, "my_test_counter_total").GetMetric()[1].GetCounter().GetValue(), float64(1))
}

func TestGauge(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{},
		[]*regexp.Regexp{},
	)

	p.AddGauge("my.test.gauge", "my test gauge", 1, attribute.String("test", "test"))
	p.AddGauge("my.test.gauge", "my test gauge", -1, attribute.String("test", "test"))
	p.AddGauge("my.test.gauge", "my test gauge", 2, attribute.String("test", "test"))

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.Equal(t, findMetric(metrics, "my_test_gauge").GetMetric()[0].GetGauge().GetValue(), float64(2))

	// with unique labels values should provide unique metrics

	p.AddGauge("my.test.gauge", "my test counter", 10, attribute.String("test", "test-2"))

	metrics, err = p.Registry().Gather()
	require.Nil(t, err)

	require.Len(t, findMetric(metrics, "my_test_gauge").GetMetric(), 2)
	require.Equal(t, findMetric(metrics, "my_test_gauge").GetMetric()[1].GetGauge().GetValue(), float64(10))
}

func TestHistogram(t *testing.T) {
	p := NewPromClient(zap.NewNop(),
		[]*regexp.Regexp{},
		[]*regexp.Regexp{},
	)

	buckets := prometheus.LinearBuckets(0, 10, 4)

	p.AddHistogram("my.test.histogram", "my test histogram", 10, buckets, attribute.String("test", "test"))
	p.AddHistogram("my.test.histogram", "my test histogram", 20, buckets, attribute.String("test", "test"))
	p.AddHistogram("my.test.histogram", "my test histogram", 30, buckets, attribute.String("test", "test"))

	metrics, err := p.Registry().Gather()
	require.Nil(t, err)

	require.Equal(t, 35, len(metrics))
	require.Equal(t, findMetric(metrics, "my_test_histogram").GetMetric()[0].GetHistogram().Bucket[0].GetCumulativeCount(), uint64(0))
	require.Equal(t, findMetric(metrics, "my_test_histogram").GetMetric()[0].GetHistogram().Bucket[1].GetCumulativeCount(), uint64(1))
	require.Equal(t, findMetric(metrics, "my_test_histogram").GetMetric()[0].GetHistogram().Bucket[2].GetCumulativeCount(), uint64(2))
	require.Equal(t, findMetric(metrics, "my_test_histogram").GetMetric()[0].GetHistogram().Bucket[3].GetCumulativeCount(), uint64(3))

	// with unique labels values should provide unique metrics

	p.AddHistogram("my.test.histogram", "my test histogram", 30, buckets, attribute.String("test", "test-2"))

	metrics, err = p.Registry().Gather()
	require.Nil(t, err)

	require.Len(t, findMetric(metrics, "my_test_histogram").GetMetric(), 2)
	require.Equal(t, findMetric(metrics, "my_test_histogram").GetMetric()[0].GetHistogram().Bucket[2].GetCumulativeCount(), uint64(2))
}

func findMetric(metrics []*io_prometheus_client.MetricFamily, name string) *io_prometheus_client.MetricFamily {
	for _, m := range metrics {
		if m.GetName() == name {
			return m
		}
	}
	return nil
}
