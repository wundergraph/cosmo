package trace

import (
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"net/http"
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
	PropagatorDatadog      Propagator = "datadog"

	DefaultBatchTimeout  = 10 * time.Second
	DefaultExportTimeout = 30 * time.Second
)

type ExporterConfig struct {
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
	// WithNewRoot specifies that the Span should be treated as a root Span. Any existing parent span context will be ignored when defining the Span's trace identifiers.
	WithNewRoot bool
	// Sampler represents the sampler for tracing. The default value is 1.
	Sampler float64
	// ParentBasedSampler specifies if the parent-based sampler should be used. The default value is true.
	ParentBasedSampler bool
	// ExportGraphQLVariables defines if and how GraphQL variables should be exported as span attributes.
	ExportGraphQLVariables ExportGraphQLVariables
	Exporters              []*ExporterConfig
	Propagators            []Propagator
	SpanAttributesMapper   func(req *http.Request) []attribute.KeyValue
	ResourceAttributes     []attribute.KeyValue
	// TestMemoryExporter is used for testing purposes. If set, the exporter will be used instead of the configured exporters.
	TestMemoryExporter  sdktrace.SpanExporter
	ResponseTraceHeader config.ResponseTraceHeader
}

func DefaultExporter(cfg *Config) *ExporterConfig {
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
		Enabled:            false,
		Name:               ServerName,
		Version:            serviceVersion,
		Sampler:            1,
		WithNewRoot:        false,
		ParentBasedSampler: true,
		ExportGraphQLVariables: ExportGraphQLVariables{
			Enabled: true,
		},
		SpanAttributesMapper: nil,
		ResourceAttributes:   make([]attribute.KeyValue, 0),
		Exporters: []*ExporterConfig{
			{
				Disabled:      false,
				Endpoint:      "http://localhost:4318",
				Exporter:      otelconfig.ExporterOLTPHTTP,
				HTTPPath:      otelconfig.DefaultTracesPath,
				BatchTimeout:  DefaultBatchTimeout,
				ExportTimeout: DefaultExportTimeout,
			},
		},
		ResponseTraceHeader: config.ResponseTraceHeader{
			Enabled:    false,
			HeaderName: "x-wg-trace-id",
		},
	}
}
