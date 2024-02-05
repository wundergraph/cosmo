package trace

import (
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"net/url"
	"time"
)

// ServerName Default resource name.
const ServerName = "cosmo-router"

type Propagator string

const (
	PropagatorTraceContext Propagator = "tracecontext"
	PropagatorB3           Propagator = "b3"
	PropagatorJaeger       Propagator = "jaeger"
	PropagatorBaggage      Propagator = "baggage"

	DefaultBatchTimeout  = 10 * time.Second
	DefaultExportTimeout = 30 * time.Second
)

type Exporter struct {
	Disabled bool
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

type ExportGraphQLVariables struct {
	Enabled bool
}

// Config represents the configuration for the agent.
type Config struct {
	Enabled bool
	// Name represents the service name for tracing. The default value is cosmo-router.
	Name string
	// Version represents the service version for tracing. The default value is dev.
	Version string
	// Sampler represents the sampler for tracing. The default value is 1.
	Sampler float64
	// ExportGraphQLVariables defines if and how GraphQL variables should be exported as span attributes.
	ExportGraphQLVariables ExportGraphQLVariables
	Exporters              []*Exporter
	Propagators            []Propagator
}

func DefaultExporter(cfg *Config) *Exporter {
	for _, exporter := range cfg.Exporters {
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

// DefaultConfig returns the default config.
func DefaultConfig(serviceVersion string) *Config {
	return &Config{
		Enabled: false,
		Name:    ServerName,
		Version: serviceVersion,
		Sampler: 1,
		ExportGraphQLVariables: ExportGraphQLVariables{
			Enabled: true,
		},
		Exporters: []*Exporter{
			{
				Disabled:      false,
				Endpoint:      "http://localhost:4318",
				Exporter:      otelconfig.ExporterOLTPHTTP,
				HTTPPath:      otelconfig.DefaultTracesPath,
				BatchTimeout:  DefaultBatchTimeout,
				ExportTimeout: DefaultExportTimeout,
			},
		},
	}
}
