package otelconfig

import "os"

type Exporter string

const (
	ExporterOLTPHTTP Exporter = "http"
	ExporterOLTPGRPC Exporter = "grpc"

	CloudDefaultTelemetryEndpoint = "https://cosmo-otel.wundergraph.com"
	DefaultMetricsPath            = "/v1/metrics"
	DefaultTracesPath             = "/v1/traces"
)

// DefaultEndpoint is the default endpoint used by subsystems that
// report OTEL data (e.g. metrics, traces, etc...)
func DefaultEndpoint() string {
	// Allow overriding this during development
	if ep := os.Getenv("DEFAULT_TELEMETRY_ENDPOINT"); ep != "" {
		return ep
	}
	return CloudDefaultTelemetryEndpoint
}

// DefaultEndpointHeaders returns the headers required to talk to the default
// endpoint
func DefaultEndpointHeaders(authToken string) map[string]string {
	return map[string]string{
		"Authorization": "Bearer " + authToken,
	}
}
