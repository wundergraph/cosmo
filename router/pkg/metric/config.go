package metric

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"net/url"
	"regexp"
)

// DefaultServerName Default resource name.
const DefaultServerName = "cosmo-router"

type PrometheusConfig struct {
	Enabled    bool
	ListenAddr string
	Path       string
	// Metrics to exclude from Prometheus exporter
	ExcludeMetrics []*regexp.Regexp
	// Metric labels to exclude from Prometheus exporter
	ExcludeMetricLabels []*regexp.Regexp
	// TestRegistry is used for testing purposes. If set, the registry will be used instead of the default one.
	TestRegistry *prometheus.Registry
}

type OpenTelemetryExporter struct {
	Disabled bool
	Exporter otelconfig.Exporter
	Endpoint string
	// Headers represents the headers for HTTP transport.
	// For example:
	//  Authorization: 'Bearer <token>'
	Headers map[string]string
	// HTTPPath represents the path for OTLP HTTP transport.
	// For example
	// /v1/metrics
	HTTPPath string
}

type OpenTelemetry struct {
	Enabled       bool
	RouterRuntime bool
	Exporters     []*OpenTelemetryExporter
	// TestReader is used for testing purposes. If set, the reader will be used instead of the configured exporters.
	TestReader sdkmetric.Reader
}

func GetDefaultExporter(cfg *Config) *OpenTelemetryExporter {
	for _, exporter := range cfg.OpenTelemetry.Exporters {
		if exporter.Disabled {
			continue
		}
		u, err := url.Parse(exporter.Endpoint)
		if err != nil {
			continue
		}
		u2, err := url.Parse(otelconfig.DefaultEndpoint())
		if err != nil {
			continue
		}
		if u.Host == u2.Host {
			return exporter
		}
	}
	return nil
}

// Config represents the configuration for the agent.
type Config struct {
	// Name represents the service name for metrics. The default value is cosmo-router.
	Name string

	// Version represents the service version for metrics. The default value is dev.
	Version string

	// OpenTelemetry includes the OpenTelemetry configuration
	OpenTelemetry OpenTelemetry

	// Prometheus includes the Prometheus configuration
	Prometheus PrometheusConfig

	// ResourceAttributes added to the global resource attributes for all metrics.
	ResourceAttributes []attribute.KeyValue

	Attributes []config.CustomAttribute
}

func (c *Config) IsEnabled() bool {
	return c != nil && (c.OpenTelemetry.Enabled || c.Prometheus.Enabled)
}

// DefaultConfig returns the default config.
func DefaultConfig(serviceVersion string) *Config {

	return &Config{
		Name:               DefaultServerName,
		Version:            serviceVersion,
		ResourceAttributes: make([]attribute.KeyValue, 0),
		Attributes:         make([]config.CustomAttribute, 0),
		OpenTelemetry: OpenTelemetry{
			Enabled:       false,
			RouterRuntime: true,
			Exporters: []*OpenTelemetryExporter{
				{
					Disabled: false,
					Endpoint: "http://localhost:4318",
					Exporter: otelconfig.ExporterOLTPHTTP,
					HTTPPath: otelconfig.DefaultMetricsPath,
				},
			},
		},
		Prometheus: PrometheusConfig{
			Enabled:    false,
			ListenAddr: "0.0.0.0:8088",
			Path:       "/metrics",
		},
	}
}
