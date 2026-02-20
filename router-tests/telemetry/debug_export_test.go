package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/core"
	"github.com/wundergraph/cosmo/router/pkg/config"
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestDebugExportLogging(t *testing.T) {
	t.Parallel()

	t.Run("logs non-excluded metrics and skips excluded ones", func(t *testing.T) {
		t.Parallel()

		obsCore, obs := observer.New(zap.InfoLevel)
		log := zap.New(obsCore)

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		cfg := &rmetric.Config{
			Name:    "test-router",
			Version: "test",
			OpenTelemetry: rmetric.OpenTelemetry{
				Enabled: true,
				Exporters: []*rmetric.OpenTelemetryExporter{
					{
						Endpoint: server.URL,
						Exporter: otelconfig.ExporterOLTPHTTP,
						HTTPPath: "/v1/metrics",
						DebugExport: rmetric.DebugExportConfig{
							Enabled: true,
							ExcludeMetrics: []*regexp.Regexp{
								regexp.MustCompile(`excluded\.`),
							},
						},
					},
				},
			},
		}

		ctx := context.Background()
		mp, err := rmetric.NewOtlpMeterProvider(ctx, log, cfg, "test-instance")
		require.NoError(t, err)
		defer mp.Shutdown(ctx)

		meter := mp.Meter("test")

		counter, err := meter.Int64Counter("http.server.requests")
		require.NoError(t, err)
		counter.Add(ctx, 7)

		excludedCounter, err := meter.Int64Counter("excluded.noisy.metric")
		require.NoError(t, err)
		excludedCounter.Add(ctx, 5)

		err = mp.ForceFlush(ctx)
		require.NoError(t, err)

		time.Sleep(100 * time.Millisecond)

		metricLogs := obs.FilterMessage("Metric").All()

		included := findMetricLog(metricLogs, "http.server.requests")
		require.NotNil(t, included, "expected non-excluded metric to be logged")

		cm := included.ContextMap()
		require.Equal(t, "Sum[int64]", cm["type"])
		require.Equal(t, "CumulativeTemporality", cm["temporality"])
		require.Equal(t, true, cm["monotonic"])

		dataPoints := getDataPointStrings(t, cm)
		require.Len(t, dataPoints, 1)
		require.Contains(t, dataPoints[0], "value=7")

		excluded := findMetricLog(metricLogs, "excluded.noisy.metric")
		require.Nil(t, excluded, "expected excluded metric to NOT be logged")
	})

	t.Run("logs all metrics when no exclude patterns configured", func(t *testing.T) {
		t.Parallel()

		obsCore, obs := observer.New(zap.InfoLevel)
		log := zap.New(obsCore)

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		cfg := &rmetric.Config{
			Name:    "test-router",
			Version: "test",
			OpenTelemetry: rmetric.OpenTelemetry{
				Enabled: true,
				Exporters: []*rmetric.OpenTelemetryExporter{
					{
						Endpoint: server.URL,
						Exporter: otelconfig.ExporterOLTPHTTP,
						HTTPPath: "/v1/metrics",
						DebugExport: rmetric.DebugExportConfig{
							Enabled: true,
						},
					},
				},
			},
		}

		ctx := context.Background()
		mp, err := rmetric.NewOtlpMeterProvider(ctx, log, cfg, "test-instance")
		require.NoError(t, err)
		defer mp.Shutdown(ctx)

		meter := mp.Meter("test")

		counter, err := meter.Int64Counter("process.cpu.time")
		require.NoError(t, err)
		counter.Add(ctx, 3)

		gauge, err := meter.Float64Gauge("server.uptime")
		require.NoError(t, err)
		gauge.Record(ctx, 99.5)

		err = mp.ForceFlush(ctx)
		require.NoError(t, err)

		time.Sleep(100 * time.Millisecond)

		metricLogs := obs.FilterMessage("Metric").All()

		counterLog := findMetricLog(metricLogs, "process.cpu.time")
		require.NotNil(t, counterLog, "expected process.cpu.time to be logged")
		counterCM := counterLog.ContextMap()
		require.Equal(t, "Sum[int64]", counterCM["type"])
		require.Equal(t, true, counterCM["monotonic"])
		counterDPs := getDataPointStrings(t, counterCM)
		require.Len(t, counterDPs, 1)
		require.Contains(t, counterDPs[0], "value=3")

		gaugeLog := findMetricLog(metricLogs, "server.uptime")
		require.NotNil(t, gaugeLog, "expected server.uptime to be logged")
		gaugeCM := gaugeLog.ContextMap()
		require.Equal(t, "Gauge[float64]", gaugeCM["type"])
		gaugeDPs := getDataPointStrings(t, gaugeCM)
		require.Len(t, gaugeDPs, 1)
		require.Contains(t, gaugeDPs[0], "value=99.5")
	})

	t.Run("does not log when debug export is disabled", func(t *testing.T) {
		t.Parallel()

		obsCore, obs := observer.New(zap.InfoLevel)
		log := zap.New(obsCore)

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		cfg := &rmetric.Config{
			Name:    "test-router",
			Version: "test",
			OpenTelemetry: rmetric.OpenTelemetry{
				Enabled: true,
				Exporters: []*rmetric.OpenTelemetryExporter{
					{
						Endpoint: server.URL,
						Exporter: otelconfig.ExporterOLTPHTTP,
						HTTPPath: "/v1/metrics",
						DebugExport: rmetric.DebugExportConfig{
							Enabled: false,
						},
					},
				},
			},
		}

		ctx := context.Background()
		mp, err := rmetric.NewOtlpMeterProvider(ctx, log, cfg, "test-instance")
		require.NoError(t, err)
		defer mp.Shutdown(ctx)

		meter := mp.Meter("test")
		counter, err := meter.Int64Counter("http.requests")
		require.NoError(t, err)
		counter.Add(ctx, 1)

		err = mp.ForceFlush(ctx)
		require.NoError(t, err)

		time.Sleep(100 * time.Millisecond)

		startLogs := obs.FilterMessage("Starting OTLP metric export").All()
		require.Empty(t, startLogs, "expected no debug export logs when disabled")

		metricLogs := obs.FilterMessage("Metric").All()
		require.Empty(t, metricLogs, "expected no metric logs when debug export is disabled")
	})

	t.Run("logs correct metric type, temporality, and data point values", func(t *testing.T) {
		t.Parallel()

		obsCore, obs := observer.New(zap.InfoLevel)
		log := zap.New(obsCore)

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()

		cfg := &rmetric.Config{
			Name:    "test-router",
			Version: "test",
			OpenTelemetry: rmetric.OpenTelemetry{
				Enabled: true,
				Exporters: []*rmetric.OpenTelemetryExporter{
					{
						Endpoint: server.URL,
						Exporter: otelconfig.ExporterOLTPHTTP,
						HTTPPath: "/v1/metrics",
						DebugExport: rmetric.DebugExportConfig{
							Enabled: true,
						},
					},
				},
			},
		}

		ctx := context.Background()
		mp, err := rmetric.NewOtlpMeterProvider(ctx, log, cfg, "test-instance")
		require.NoError(t, err)
		defer mp.Shutdown(ctx)

		meter := mp.Meter("test")

		counter, err := meter.Int64Counter("my.counter")
		require.NoError(t, err)
		counter.Add(ctx, 42)

		histogram, err := meter.Float64Histogram("my.histogram")
		require.NoError(t, err)
		histogram.Record(ctx, 3.14)

		gauge, err := meter.Float64Gauge("my.gauge")
		require.NoError(t, err)
		gauge.Record(ctx, 99.5)

		err = mp.ForceFlush(ctx)
		require.NoError(t, err)

		time.Sleep(100 * time.Millisecond)

		// Verify export lifecycle logs
		startLogs := obs.FilterMessage("Starting OTLP metric export").All()
		require.NotEmpty(t, startLogs)
		startCM := startLogs[0].ContextMap()
		require.Contains(t, startCM, "resource")
		require.Contains(t, startCM, "scope_metrics")
		require.Contains(t, startCM, "total_metrics")

		successLogs := obs.FilterMessage("OTLP metric export succeeded").All()
		require.NotEmpty(t, successLogs)
		successCM := successLogs[0].ContextMap()
		require.Contains(t, successCM, "total_metrics")
		require.Contains(t, successCM, "duration")

		// Verify counter (Sum[int64])
		metricLogs := obs.FilterMessage("Metric").All()

		counterLog := findMetricLog(metricLogs, "my.counter")
		require.NotNil(t, counterLog, "expected log entry for my.counter")
		counterCM := counterLog.ContextMap()
		require.Equal(t, "Sum[int64]", counterCM["type"])
		require.Equal(t, "CumulativeTemporality", counterCM["temporality"])
		require.Equal(t, true, counterCM["monotonic"])
		counterDPs := getDataPointStrings(t, counterCM)
		require.Len(t, counterDPs, 1)
		require.Contains(t, counterDPs[0], "value=42")

		// Verify histogram (Histogram[float64])
		histLog := findMetricLog(metricLogs, "my.histogram")
		require.NotNil(t, histLog, "expected log entry for my.histogram")
		histCM := histLog.ContextMap()
		require.Equal(t, "Histogram[float64]", histCM["type"])
		require.Equal(t, "CumulativeTemporality", histCM["temporality"])
		histDPs := getDataPointStrings(t, histCM)
		require.Len(t, histDPs, 1)
		require.Contains(t, histDPs[0], "count=1")
		require.Contains(t, histDPs[0], "sum=3.14")

		// Verify gauge (Gauge[float64])
		gaugeLog := findMetricLog(metricLogs, "my.gauge")
		require.NotNil(t, gaugeLog, "expected log entry for my.gauge")
		gaugeCM := gaugeLog.ContextMap()
		require.Equal(t, "Gauge[float64]", gaugeCM["type"])
		gaugeDPs := getDataPointStrings(t, gaugeCM)
		require.Len(t, gaugeDPs, 1)
		require.Contains(t, gaugeDPs[0], "value=99.5")
	})

	t.Run("logs export failure on bad endpoint", func(t *testing.T) {
		t.Parallel()

		obsCore, obs := observer.New(zap.InfoLevel)
		log := zap.New(obsCore)

		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer server.Close()

		cfg := &rmetric.Config{
			Name:    "test-router",
			Version: "test",
			OpenTelemetry: rmetric.OpenTelemetry{
				Enabled: true,
				Exporters: []*rmetric.OpenTelemetryExporter{
					{
						Endpoint: server.URL,
						Exporter: otelconfig.ExporterOLTPHTTP,
						HTTPPath: "/v1/metrics",
						DebugExport: rmetric.DebugExportConfig{
							Enabled: true,
						},
					},
				},
			},
		}

		ctx := context.Background()
		mp, err := rmetric.NewOtlpMeterProvider(ctx, log, cfg, "test-instance")
		require.NoError(t, err)
		defer mp.Shutdown(ctx)

		meter := mp.Meter("test")
		counter, err := meter.Int64Counter("some.metric")
		require.NoError(t, err)
		counter.Add(ctx, 1)

		// ForceFlush may return an error due to the 500, but we still expect the debug logs
		_ = mp.ForceFlush(ctx)

		time.Sleep(100 * time.Millisecond)

		startLogs := obs.FilterMessage("Starting OTLP metric export").All()
		require.NotEmpty(t, startLogs, "expected start log even on export failure")

		errorLogs := obs.FilterMessage("OTLP metric export failed").All()
		require.NotEmpty(t, errorLogs, "expected error log on failed export")
		errorCM := errorLogs[0].ContextMap()
		require.Contains(t, errorCM, "error")
		require.Contains(t, errorCM, "duration")
	})
}

func TestDebugExportConfigWiring(t *testing.T) {
	t.Parallel()

	t.Run("maps per-exporter debug export config", func(t *testing.T) {
		t.Parallel()

		excludePatterns := config.RegExArray{
			regexp.MustCompile(`process\.`),
			regexp.MustCompile(`server\.uptime`),
		}

		cfg := &config.Telemetry{
			ServiceName: "cosmo-router",
			Metrics: config.Metrics{
				OTLP: config.MetricsOTLP{
					Enabled: true,
					Exporters: []config.MetricsOTLPExporter{
						{
							Exporter: "http",
							Endpoint: "http://localhost:4318",
							ExportDebugLogging: config.ExportDebugLogging{
								Enabled:        true,
								ExcludeMetrics: excludePatterns,
							},
						},
						{
							Exporter: "http",
							Endpoint: "http://other-collector:4318",
						},
					},
				},
			},
		}

		result := core.MetricConfigFromTelemetry(cfg)

		require.Len(t, result.OpenTelemetry.Exporters, 2)

		exp0 := result.OpenTelemetry.Exporters[0]
		require.True(t, exp0.DebugExport.Enabled)
		require.Len(t, exp0.DebugExport.ExcludeMetrics, 2)
		require.True(t, exp0.DebugExport.ExcludeMetrics[0].MatchString("process.cpu"))
		require.True(t, exp0.DebugExport.ExcludeMetrics[1].MatchString("server.uptime"))
		require.False(t, exp0.DebugExport.ExcludeMetrics[0].MatchString("http.requests"))

		exp1 := result.OpenTelemetry.Exporters[1]
		require.False(t, exp1.DebugExport.Enabled)
		require.Empty(t, exp1.DebugExport.ExcludeMetrics)
	})
}

func TestDebugExportConfigYAMLSchema(t *testing.T) {
	t.Parallel()

	t.Run("validates config with per-exporter debug logging", func(t *testing.T) {
		t.Parallel()

		yamlContent := []byte(`
version: "1"
telemetry:
  metrics:
    otlp:
      exporters:
        - exporter: http
          endpoint: http://localhost:4318
          export_debug_logging:
            enabled: true
            exclude_metrics:
              - "process\\."
              - "server\\.uptime"
`)
		err := config.ValidateConfig(yamlContent, config.JSONSchema)
		require.NoError(t, err)
	})

	t.Run("rejects invalid properties in export_debug_logging", func(t *testing.T) {
		t.Parallel()

		yamlContent := []byte(`
version: "1"
telemetry:
  metrics:
    otlp:
      exporters:
        - exporter: http
          endpoint: http://localhost:4318
          export_debug_logging:
            enabled: true
            invalid_field: true
`)
		err := config.ValidateConfig(yamlContent, config.JSONSchema)
		require.Error(t, err)
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

// containsDataPointWithValue checks if any data point string contains the expected value substring.
func containsDataPointWithValue(dataPoints []string, value string) bool {
	for _, dp := range dataPoints {
		if strings.Contains(dp, value) {
			return true
		}
	}
	return false
}
