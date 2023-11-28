package trace

import (
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"
)

// ServerName Default resource name.
const ServerName = "cosmo-router"

type Exporter struct {
	Endpoint string

	Exporter      otelconfig.Exporter
	BatchTimeout  time.Duration
	ExportTimeout time.Duration
	// Headers represents the headers for HTTP transport.
	// For example:
	//  Authorization: 'Bearer <token>'
	Headers map[string]string
	// HTTPPath represents the path for OTLP HTTP transport.
	// For example
	// /v1/traces
	HTTPPath string
}

// Config represents the configuration for the agent.
type Config struct {
	Enabled bool
	// Name represents the service name for tracing. The default value is cosmo-router.
	Name string
	// Sampler represents the sampler for tracing. The default value is 1.
	Sampler   float64
	Exporters []*Exporter
}

func HasDefaultExporter(cfg *Config) bool {
	for _, exporter := range cfg.Exporters {
		u, err := url.Parse(exporter.Endpoint)
		if err != nil {
			continue
		}
		u2, err := url.Parse(otelconfig.DefaultEndpoint())
		if err != nil {
			continue
		}
		if u.Host == u2.Host {
			return true
		}
	}
	return false
}

// DefaultConfig returns the default config.
func DefaultConfig() *Config {
	return &Config{
		Enabled: false,
		Name:    ServerName,
		Sampler: 1,
		Exporters: []*Exporter{
			{
				Endpoint:      "http://localhost:4318",
				BatchTimeout:  defaultBatchTimeout,
				ExportTimeout: defaultExportTimeout,
			},
		},
	}
}
