package telemetry

import (
	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/attribute"

	otelmetric "go.opentelemetry.io/otel/metric"
)

const (
	DefaultServerName = "cosmo-graphqlmetrics"
	serviceVersion    = "dev"
)

type CustomMetrics struct {
	counters map[string]otelmetric.Int64Counter
}

// NewTelemetryConfig creates the config to be used for the
// telemetry inside graphqlmetrics.
func NewTelemetryConfig(prometheusConfig PrometheusConfig) *Config {
	return &Config{
		Name:       DefaultServerName,
		Version:    serviceVersion,
		Prometheus: prometheusConfig,
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
	// CustomPrometheusMetrics to be collected
	CustomMetrics CustomMetrics

	ResourceAttributes []attribute.KeyValue

	MetricStore Provider
}

type PrometheusConfig struct {
	Enabled      bool
	ListenAddr   string
	Path         string
	TestRegistry *prometheus.Registry
}

func (c *Config) IsEnabled() bool {
	return c != nil && c.Prometheus.Enabled
}
