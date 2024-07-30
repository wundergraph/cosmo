package telemetry

import (
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"
)

const (
	DefaultServerName = "cosmo-graphqlmetrics"
	serviceVersion    = "dev"
)

type CustomMetrics struct {
	MetricsServiceAccessCounter *prometheus.CounterVec
}

// NewTelemetryConfig creates the config to be used for the
// telemetry inside graphqlmetrics.
func NewTelemetryConfig(prometheusConfig PrometheusConfig, opentelemetryConfig OpenTelemetry) *Config {
	return &Config{
		Name:          DefaultServerName,
		Version:       serviceVersion,
		Prometheus:    prometheusConfig,
		OpenTelemetry: opentelemetryConfig,
	}
}

// Config represents the configuration for the agent.
type Config struct {
	// Name represents the service name for metrics. The default value is cosmo-router.
	Name string
	// Version represents the service version for metrics. The default value is dev.
	Version string
	// Prometheus includes the Prometheus configuration
	Prometheus PrometheusConfig
	// OpenTelemetry used to enable tracing
	OpenTelemetry OpenTelemetry
	// CustomPrometheusMetrics to be collected
	CustomMetrics      CustomMetrics
	ResourceAttributes []attribute.KeyValue
}

type OpenTelemetryExporter struct {
	Disabled      bool
	Exporter      Exporter
	Endpoint      string
	BatchTimeout  time.Duration
	ExportTimeout time.Duration
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
	// TestReader is used for testing purposes. If set, the reader will be used instead of the configured exporters.
	TestReader sdkmetric.Reader
	Config     *ProviderConfig
}

const (
	Hash   IPAnonymizationMethod = "hash"
	Redact IPAnonymizationMethod = "redact"
)

type (
	IPAnonymizationMethod string

	IPAnonymizationConfig struct {
		Enabled bool
		Method  IPAnonymizationMethod
	}

	ProviderConfig struct {
		Logger            *zap.Logger
		ServiceInstanceID string
		IPAnonymization   *IPAnonymizationConfig
		// MemoryExporter is used for testing purposes
		MemoryExporter sdktrace.SpanExporter
	}
)

type PrometheusConfig struct {
	Enabled      bool
	ListenAddr   string
	Path         string
	TestRegistry *prometheus.Registry
}

func (c *Config) IsEnabled() bool {
	return c != nil && (c.OpenTelemetry.Enabled || c.Prometheus.Enabled)
}
