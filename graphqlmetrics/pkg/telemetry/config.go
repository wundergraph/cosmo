package telemetry

import (
	"github.com/prometheus/client_golang/prometheus"
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
	// OpenTelemetry used to enable tracing
	OpenTelemetry OpenTelemetry
	// CustomPrometheusMetrics to be collected
	CustomMetrics CustomMetrics
}

type OpenTelemetry struct {
	Enabled bool
}

type PrometheusConfig struct {
	Enabled      bool
	ListenAddr   string
	Path         string
	TestRegistry *prometheus.Registry
}

// currently only exporting metrics for prometheus is supported
// tracing will be added and tested in a later PR
func (c *Config) IsEnabled() bool {
	return c.Prometheus.Enabled
}
