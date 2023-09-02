package trace

import "time"

// ServerName Default resource name.
const ServerName = "cosmo-router"

// Config represents the configuration for the agent.
type Config struct {
	Enabled bool
	// Name represents the service name for tracing. The default value is wundergraph-cosmo-router.
	Name     string
	Endpoint string
	// Sampler represents the sampler for tracing. The default value is 1.
	Sampler       float64
	Batcher       KindOtlp
	BatchTimeout  time.Duration
	ExportTimeout time.Duration
	// OtlpHeaders represents the headers for HTTP transport.
	// For example:
	//  Authorization: 'Bearer <token>'
	OtlpHeaders map[string]string
	// OtlpHttpPath represents the path for OTLP HTTP transport.
	// For example
	// /v1/traces
	OtlpHttpPath string
}

// DefaultConfig returns the default config.
func DefaultConfig() *Config {
	return &Config{
		Name:          ServerName,
		Endpoint:      "http://localhost:4318",
		Sampler:       1,
		Batcher:       KindOtlpHttp,
		BatchTimeout:  10 * time.Second,
		ExportTimeout: 30 * time.Second,
		OtlpHeaders:   map[string]string{},
	}
}
