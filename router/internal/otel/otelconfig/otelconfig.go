package otelconfig

import "os"

type Exporter string

const (
	ExporterDefault  Exporter = "" // Use ExporterOLTPHTTP
	ExporterOLTPHTTP Exporter = "http"
	ExporterOLTPGRPC Exporter = "grpc"
)

// DefaultEndpoint is the default endpoint used by subsystems that
// report OTEL data (e.g. metrics, traces, etc...)
func DefaultEndpoint() string {
	// Allow overriding this during development
	if ep := os.Getenv("DEFAULT_TELEMETRY_ENDPOINT"); ep != "" {
		return ep
	}
	return "https://cosmo-otel.wundergraph.com"
}

// DefaultEndpointHeaders returns the headers required to talk to the default
// endpoint
func DefaultEndpointHeaders(authToken string) map[string]string {
	return map[string]string{
		"Authorization": "Bearer " + authToken,
	}
}
