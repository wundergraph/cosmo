package telemetry

import (
	"net/http"
	"regexp"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/attribute"
)

const (
	DefaultServerName = "cosmo-graphqlmetrics"
	serviceVersion    = "dev"
)

// NewTelemetryConfig creates a rmetric.Config without the OTEL export enabled
// this is done to reuse the config from the cosmo-router which is already
// implementing OTEL data
func NewTelemetryConfig(prometheusConfig PrometheusConfig) *Config {
	return &Config{
		Name:       DefaultServerName,
		Version:    serviceVersion,
		Prometheus: prometheusConfig,
	}
}

// used to enable tracing later on
type OpenTelemetry struct {
	Enabled bool
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

	// AttributesMapper added to the global attributes for all metrics.
	AttributesMapper func(req *http.Request) []attribute.KeyValue

	// ResourceAttributes added to the global resource attributes for all metrics.
	ResourceAttributes []attribute.KeyValue
}

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

// currently only exporting metrics for prometheus is supported
// tracing will be added and tested in a later PR
func (c *Config) IsEnabled() bool {
	return c.Prometheus.Enabled
}
