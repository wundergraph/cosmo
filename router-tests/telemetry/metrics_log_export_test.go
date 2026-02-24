package telemetry

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	integration "github.com/wundergraph/cosmo/router-tests"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestMetricsLogExporter(t *testing.T) {
	t.Parallel()

	t.Run("verify all metrics are logged when exported", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			MetricOptions: testenv.MetricOptions{
				MetricsLogExporter: testenv.MetricsLogExporterOptions{
					Enabled:            true,
					ExportInterval: 90 * time.Millisecond,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, 200, res.Response.StatusCode)

			// Wait for the debug exporter to log router.http.requests
			require.Eventually(t, func() bool {
				metricLogs := xEnv.Observer().FilterMessage("Metric").All()
				return findMetricLog(metricLogs, "router.http.requests") != nil
			}, 5*time.Second, 100*time.Millisecond)

			// Collect actual metrics from the ManualReader
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(t.Context(), &rm)
			require.NoError(t, err)

			scopeMetric := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scopeMetric)

			metricLogs := xEnv.Observer().FilterMessage("Metric").All()

			// Every actual metric in the scope should have a corresponding debug log entry
			for _, actualMetric := range scopeMetric.Metrics {
				logEntry := findMetricLog(metricLogs, actualMetric.Name)
				require.NotNil(t, logEntry, "expected debug exporter to log metric %q", actualMetric.Name)

				cm := logEntry.ContextMap()
				loggedDPs := getDataPointStrings(t, cm)

				switch data := actualMetric.Data.(type) {
				case metricdata.Sum[int64]:
					require.Equal(t, "sum:int64", cm["type"])
					require.Equal(t, data.Temporality.String(), cm["temporality"])
					require.Equal(t, data.IsMonotonic, cm["monotonic"])
					requireAllDataPointsLogged(t, loggedDPs, data.DataPoints, func(dp metricdata.DataPoint[int64]) string {
						return fmt.Sprintf("value=%d", dp.Value)
					}, actualMetric.Name)

				case metricdata.Histogram[float64]:
					require.Equal(t, "histogram:float64", cm["type"])
					require.Equal(t, data.Temporality.String(), cm["temporality"])
					requireAllDataPointsLogged(t, loggedDPs, data.DataPoints, func(dp metricdata.HistogramDataPoint[float64]) string {
						return fmt.Sprintf("count=%d", dp.Count)
					}, actualMetric.Name)

				case metricdata.Gauge[int64]:
					require.Equal(t, "gauge:int64", cm["type"])
					requireAllDataPointsLogged(t, loggedDPs, data.DataPoints, func(dp metricdata.DataPoint[int64]) string {
						return fmt.Sprintf("value=%d", dp.Value)
					}, actualMetric.Name)

				case metricdata.Gauge[float64]:
					require.Equal(t, "gauge:float64", cm["type"])
					requireAllDataPointsLogged(t, loggedDPs, data.DataPoints, func(dp metricdata.DataPoint[float64]) string {
						return fmt.Sprintf("value=%v", dp.Value)
					}, actualMetric.Name)

				default:
					require.Failf(t, "unexpected metric data type for %s: %T", actualMetric.Name, actualMetric.Data)
				}
			}
		})
	})

	t.Run("excludes metrics from logs but they still exist in reader", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			MetricOptions: testenv.MetricOptions{
				MetricsLogExporter: testenv.MetricsLogExporterOptions{
					Enabled:            true,
					ExportInterval: 100 * time.Millisecond,
					ExcludeMetrics: []*regexp.Regexp{
						regexp.MustCompile(`router\.http\.requests$`),
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, 200, res.Response.StatusCode)

			// Wait for the debug exporter to log request duration
			require.Eventually(t, func() bool {
				metricLogs := xEnv.Observer().FilterMessage("Metric").All()
				return findMetricLog(metricLogs, "router.http.request.duration_milliseconds") != nil
			}, 5*time.Second, 100*time.Millisecond)

			// Verify the metric exists in the ManualReader
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(t.Context(), &rm)
			require.NoError(t, err)

			scopeMetric := integration.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scopeMetric)

			requestsMetric := findMetricByName(scopeMetric.Metrics, "router.http.requests")
			require.NotNil(t, requestsMetric, "excluded metric should still exist in reader")

			// Verify the excluded metric was NOT logged
			metricLogs := xEnv.Observer().FilterMessage("Metric").All()
			requestsLog := findMetricLog(metricLogs, "router.http.requests")
			require.Nil(t, requestsLog, "expected excluded metric to NOT be logged")

			// Verify other metrics were logged (e.g. request duration)
			durationLog := findMetricLog(metricLogs, "router.http.request.duration_milliseconds")
			require.NotNil(t, durationLog, "expected non-excluded metric to be logged")
		})
	})

	t.Run("does not log when disabled", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			MetricOptions: testenv.MetricOptions{
				MetricsLogExporter: testenv.MetricsLogExporterOptions{
					Enabled: false,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, 200, res.Response.StatusCode)

			// Metrics still collected by the ManualReader
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(t.Context(), &rm)
			require.NoError(t, err)
			require.NotEmpty(t, rm.ScopeMetrics)

			// No debug logs
			debugLogs := xEnv.Observer().FilterMessage("Metrics log export").All()
			require.Empty(t, debugLogs)

			metricLogs := xEnv.Observer().FilterMessage("Metric").All()
			require.Empty(t, metricLogs)
		})
	})
}

// findMetricLog finds the first "Metric" log entry with the given metric name.
func findMetricLog(entries []observer.LoggedEntry, metricName string) *observer.LoggedEntry {
	for i, entry := range entries {
		if name, ok := entry.ContextMap()["name"].(string); ok && name == metricName {
			return &entries[i]
		}
	}
	return nil
}

// getDataPointStrings extracts the data_points string slice from a log entry's context map.
func getDataPointStrings(t *testing.T, cm map[string]interface{}) []string {
	t.Helper()
	raw, ok := cm["data_points"].([]interface{})
	require.True(t, ok, "expected data_points field in log entry")
	result := make([]string, len(raw))
	for i, v := range raw {
		s, ok := v.(string)
		require.True(t, ok, "expected data_points element to be a string")
		result[i] = s
	}
	return result
}

// requireAllDataPointsLogged verifies that every logged data point matches an actual data point.
// The debug exporter and ManualReader collect at different times, so logged may be a subset of actual.
func requireAllDataPointsLogged[T any](t *testing.T, loggedDPs []string, dataPoints []T, format func(T) string, metricName string) {
	t.Helper()

	require.NotEmpty(t, loggedDPs, "expected at least one logged data point for %s", metricName)

	for _, logged := range loggedDPs {
		found := false
		for _, dp := range dataPoints {
			if strings.Contains(logged, format(dp)) {
				found = true
				break
			}
		}
		require.True(t, found, "metric %q: logged data point %q has no matching actual data point", metricName, logged)
	}
}

// findMetricByName finds a Metrics entry by name.
func findMetricByName(metrics []metricdata.Metrics, name string) *metricdata.Metrics {
	for i, m := range metrics {
		if m.Name == name {
			return &metrics[i]
		}
	}
	return nil
}
