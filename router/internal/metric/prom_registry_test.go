package metric

import (
	prom "github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestExcludeMetrics(t *testing.T) {
	r := prom.NewRegistry()

	httpReqs := prom.NewCounterVec(
		prom.CounterOpts{
			Name: "http_requests_total",
			Help: "How many HTTP requests processed, partitioned by status code and HTTP method.",
		},
		[]string{"code", "method"},
	)
	httpInFlight := prom.NewCounterVec(
		prom.CounterOpts{
			Name: "http_requests_inflight_total",
			Help: "How many HTTP requests processed, partitioned by status code and HTTP method.",
		},
		[]string{"code", "method"},
	)

	r.MustRegister(httpReqs)
	r.MustRegister(httpInFlight)
	httpReqs.WithLabelValues("404", "POST").Add(5)
	httpInFlight.WithLabelValues("404", "POST").Add(42)

	ct, err := NewPromRegistry(r, []string{"^http_requests_total$"}, []string{})
	require.NoError(t, err)

	a, err := ct.Gather()
	require.NoError(t, err)

	require.Equal(t, 1, len(a))
	require.Equal(t, "http_requests_inflight_total", a[0].GetName())
}

func TestExcludeMetricLabels(t *testing.T) {
	r := prom.NewRegistry()

	httpReqs := prom.NewCounterVec(
		prom.CounterOpts{
			Name: "http_requests_total",
			Help: "How many HTTP requests processed, partitioned by status code and HTTP method.",
		},
		[]string{"code", "method"},
	)
	httpInFlight := prom.NewCounterVec(
		prom.CounterOpts{
			Name: "http_requests_inflight_total",
			Help: "How many HTTP requests processed, partitioned by status code and HTTP method.",
		},
		[]string{"code", "method"},
	)

	r.MustRegister(httpReqs)
	r.MustRegister(httpInFlight)
	httpReqs.WithLabelValues("404", "POST").Add(5)
	httpInFlight.WithLabelValues("404", "POST").Add(42)

	ct, err := NewPromRegistry(r, []string{}, []string{"^code$"})
	require.NoError(t, err)

	a, err := ct.Gather()
	require.NoError(t, err)

	require.Equal(t, 2, len(a))
	require.Equal(t, "http_requests_inflight_total", a[0].GetName())
	require.Equal(t, "http_requests_total", a[1].GetName())
	require.Equal(t, 1, len(a[0].GetMetric()[0].GetLabel()))
	require.Equal(t, "method", a[0].GetMetric()[0].GetLabel()[0].GetName())
	require.Equal(t, 1, len(a[1].GetMetric()[0].GetLabel()))
	require.Equal(t, "method", a[1].GetMetric()[0].GetLabel()[0].GetName())
}
