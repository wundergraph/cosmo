package metric

import (
	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"
	"net/url"
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
	Enabled   bool
	Exporters []*OpenTelemetryExporter
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
					Disabled: false,
					Endpoint: "http://localhost:4318",
					Exporter: otelconfig.ExporterOLTPHTTP,
					HTTPPath: "/v1/metrics",
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
