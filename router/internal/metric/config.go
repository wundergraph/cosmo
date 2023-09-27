package metric

import "github.com/wundergraph/cosmo/router/internal/otel/otelconfig"

// ServerName Default resource name.
const ServerName = "cosmo-router"

type Prometheus struct {
	Enabled    bool
	ListenAddr string
	Path       string
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
	Exporters []*OpenTelemetryExporter
}

// Config represents the configuration for the agent.
type Config struct {
	Enabled bool
	// Name represents the service name for tracing. The default value is wundergraph-cosmo-router.
	Name string

	// OpenTelemetry includes the OpenTelemetry configuration
	OpenTelemetry OpenTelemetry

	Prometheus Prometheus
}

// DefaultConfig returns the default config.
func DefaultConfig() *Config {
	return &Config{
		Enabled: false,
		Name:    ServerName,
		OpenTelemetry: OpenTelemetry{
			Exporters: []*OpenTelemetryExporter{
				{
					Endpoint: "http://localhost:4318",
				},
			},
		},
		Prometheus: Prometheus{
			Enabled:    true,
			ListenAddr: "0.0.0.0:9090",
			Path:       "/metrics",
		},
	}
}
