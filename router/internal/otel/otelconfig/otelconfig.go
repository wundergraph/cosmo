package otelconfig

type Exporter string

const (
	ExporterDefault  Exporter = "" // Use otlphttp
	ExporterOLTPHTTP Exporter = "otlphttp"
	ExporterOLTPGRPC Exporter = "otlpgrpc"
)

const (
	// DefaultEndpoint is the default endpoint used by subsystems that
	// report OTEL data (e.g. metrics, traces, etc...)
	DefaultEndpoint = "https://cosmo-otel.wundergraph.com"
)
