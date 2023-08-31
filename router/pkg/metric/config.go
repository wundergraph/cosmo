package metric

// ServerName Default resource name.
const ServerName = "cosmo-router"

type Prometheus struct {
	Enabled    bool
	ListenAddr string
	Path       string
}

// Config represents the configuration for the agent.
type Config struct {
	Enabled bool
	// Name represents the service name for tracing. The default value is wundergraph-cosmo-router.
	Name     string
	Endpoint string
	// OtlpHeaders represents the headers for HTTP transport.
	// For example:
	//  Authorization: 'Bearer <token>'
	OtlpHeaders map[string]string
	// OtlpHttpPath represents the path for OTLP HTTP transport.
	// For example
	// /v1/metrics
	OtlpHttpPath string

	Prometheus Prometheus
}

// DefaultConfig returns the default config.
func DefaultConfig() *Config {
	return &Config{
		Enabled:      true,
		Name:         ServerName,
		Endpoint:     "http://localhost:4318",
		OtlpHeaders:  map[string]string{},
		OtlpHttpPath: "/v1/metrics",
		Prometheus: Prometheus{
			Enabled:    true,
			ListenAddr: "0.0.0.0:9090",
			Path:       "/metrics",
		},
	}
}
