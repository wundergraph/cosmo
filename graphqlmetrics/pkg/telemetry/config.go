package telemetry

import (
	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
)

const (
	DefaultServerName = "cosmo-graphqlmetrics"
	serviceVersion    = "dev"
)

// NewTelemetryConfig creates a rmetric.Config without the OTEL export enabled
// this is done to reuse the config from the cosmo-router which is already
// implementing OTEL data
func NewTelemetryConfig(prometheusConfig rmetric.PrometheusConfig) *rmetric.Config {
	return &rmetric.Config{
		Name:       DefaultServerName,
		Version:    serviceVersion,
		Prometheus: prometheusConfig,
	}
}
