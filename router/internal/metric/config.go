package metric

import (
	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"
	"regexp"
)

// ServerName Default resource name.
const ServerName = "cosmo-router"

type Prometheus struct {
	Enabled    bool
	ListenAddr string
	Path       string
	// Metrics to exclude from Prometheus exporter
	ExcludeMetrics []*regexp.Regexp
	// Metric labels to exclude from Prometheus exporter
	ExcludeMetricLabels []*regexp.Regexp
}

type OpenTelemetryExporter struct {
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
	Enabled   bool
	Exporters []*OpenTelemetryExporter
}

// Config represents the configuration for the agent.
type Config struct {
	// Name represents the service name for metrics. The default value is cosmo-router.
	Name string

	// OpenTelemetry includes the OpenTelemetry configuration
	OpenTelemetry OpenTelemetry

	Prometheus Prometheus
}

func (c *Config) IsEnabled() bool {
	return c != nil && (c.OpenTelemetry.Enabled || c.Prometheus.Enabled)
}

// DefaultConfig returns the default config.
func DefaultConfig() *Config {
	return &Config{
		Name: ServerName,
		OpenTelemetry: OpenTelemetry{
			Enabled: false,
			Exporters: []*OpenTelemetryExporter{
				{
					Endpoint: "http://localhost:4318",
				},
			},
		},
		Prometheus: Prometheus{
			Enabled:    false,
			ListenAddr: "0.0.0.0:8088",
			Path:       "/metrics",
		},
	}
}
