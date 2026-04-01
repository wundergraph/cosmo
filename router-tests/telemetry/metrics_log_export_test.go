package telemetry

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router-tests/testenv"
	"github.com/wundergraph/cosmo/router-tests/testutils"
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
				LogExporter: testenv.MetricsLogExporterOptions{
					Enabled:        true,
					ExportInterval: 90 * time.Millisecond,
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, 200, res.Response.StatusCode)

			// Collect actual metrics from the ManualReader
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(t.Context(), &rm)
			require.NoError(t, err)

			scopeMetric := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scopeMetric)

			// Wait for ALL scope metrics to appear in logs (not just one).
			// The log exporter runs on a 90ms interval, so metrics may arrive
			// across multiple export cycles.
			require.Eventually(t, func() bool {
				metricLogs := xEnv.Observer().FilterMessage("Metric").All()
				for _, m := range scopeMetric.Metrics {
					if findMetricLog(metricLogs, m.Name) == nil {
						return false
					}
				}
				return true
			}, 5*time.Second, 100*time.Millisecond)

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
				LogExporter: testenv.MetricsLogExporterOptions{
					Enabled:        true,
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

			scopeMetric := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
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

	t.Run("includes only matching metrics in logs", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			MetricOptions: testenv.MetricOptions{
				LogExporter: testenv.MetricsLogExporterOptions{
					Enabled:        true,
					ExportInterval: 100 * time.Millisecond,
					IncludeMetrics: []*regexp.Regexp{
						regexp.MustCompile(`^router\.http\.requests$`),
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, 200, res.Response.StatusCode)

			// Wait for the log exporter to log the included metric
			require.Eventually(t, func() bool {
				metricLogs := xEnv.Observer().FilterMessage("Metric").All()
				return findMetricLog(metricLogs, "router.http.requests") != nil
			}, 5*time.Second, 100*time.Millisecond)

			// Verify the included metric was logged
			metricLogs := xEnv.Observer().FilterMessage("Metric").All()
			requestsLog := findMetricLog(metricLogs, "router.http.requests")
			require.NotNil(t, requestsLog, "expected included metric to be logged")

			// Verify other metrics were NOT logged (only the included one should be)
			for _, entry := range metricLogs {
				name := entry.ContextMap()["name"].(string)
				require.Equal(t, "router.http.requests", name)
			}

			// Verify other metrics still exist in the reader
			rm := metricdata.ResourceMetrics{}
			err := metricReader.Collect(t.Context(), &rm)
			require.NoError(t, err)

			scopeMetric := testutils.GetMetricScopeByName(rm.ScopeMetrics, "cosmo.router")
			require.NotNil(t, scopeMetric)

			durationMetric := findMetricByName(scopeMetric.Metrics, "router.http.request.duration_milliseconds")
			require.NotNil(t, durationMetric, "non-included metric should still exist in reader")
		})
	})

	t.Run("include_metrics with multiple patterns logs all matching", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.Run(t, &testenv.Config{
			MetricReader: metricReader,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			MetricOptions: testenv.MetricOptions{
				LogExporter: testenv.MetricsLogExporterOptions{
					Enabled:        true,
					ExportInterval: 100 * time.Millisecond,
					IncludeMetrics: []*regexp.Regexp{
						regexp.MustCompile(`^router\.http\.requests$`),
						regexp.MustCompile(`^router\.http\.request\.duration_milliseconds$`),
					},
				},
			},
		}, func(t *testing.T, xEnv *testenv.Environment) {
			res := xEnv.MakeGraphQLRequestOK(testenv.GraphQLRequest{
				Query: `query { employees { id } }`,
			})
			require.Equal(t, 200, res.Response.StatusCode)

			// Wait for both included metrics to appear
			require.Eventually(t, func() bool {
				metricLogs := xEnv.Observer().FilterMessage("Metric").All()
				return findMetricLog(metricLogs, "router.http.requests") != nil &&
					findMetricLog(metricLogs, "router.http.request.duration_milliseconds") != nil
			}, 5*time.Second, 100*time.Millisecond)

			// Verify only included metrics were logged
			metricLogs := xEnv.Observer().FilterMessage("Metric").All()
			allowedNames := map[string]bool{
				"router.http.requests":                      true,
				"router.http.request.duration_milliseconds": true,
			}
			for _, entry := range metricLogs {
				name := entry.ContextMap()["name"].(string)
				require.True(t, allowedNames[name], "expected only included metrics to be logged, but found %q", name)
			}
		})
	})

	t.Run("fails on startup when both include and exclude are set", func(t *testing.T) {
		t.Parallel()

		metricReader := metric.NewManualReader()

		testenv.FailsOnStartup(t, &testenv.Config{
			MetricReader: metricReader,
			LogObservation: testenv.LogObservationConfig{
				Enabled:  true,
				LogLevel: zapcore.InfoLevel,
			},
			MetricOptions: testenv.MetricOptions{
				LogExporter: testenv.MetricsLogExporterOptions{
					Enabled:        true,
					ExportInterval: 100 * time.Millisecond,
					ExcludeMetrics: []*regexp.Regexp{
						regexp.MustCompile(`^router\.http\.requests$`),
					},
					IncludeMetrics: []*regexp.Regexp{
						regexp.MustCompile(`^router\.http\.request\.duration_milliseconds$`),
					},
				},
			},
		}, func(t *testing.T, err error) {
			require.ErrorContains(t, err, "metrics log exporter: exclude_metrics and include_metrics cannot be used together, use only one")
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
				LogExporter: testenv.MetricsLogExporterOptions{
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
			debugLogs := xEnv.Observer().FilterMessage("Log export").All()
			require.Empty(t, debugLogs)

			metricLogs := xEnv.Observer().FilterMessage("Metric").All()
			require.Empty(t, metricLogs)
		})
	})
}

// findMetricLog finds the last "Metric" log entry with the given metric name.
func findMetricLog(entries []observer.LoggedEntry, metricName string) *observer.LoggedEntry {
	var result *observer.LoggedEntry
	for i, entry := range entries {
		if name, ok := entry.ContextMap()["name"].(string); ok && name == metricName {
			result = &entries[i]
		}
	}
	return result
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
