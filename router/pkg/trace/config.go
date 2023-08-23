package trace

import "time"

// TraceName represents the tracing name.
const TraceName = "wundergraph-cosmo-router"

// A Config is an opentelemetry config.
type Config struct {
	// Name represents the service name for tracing. The default value is wundergraph-cosmo-router.
	Name     string
	Endpoint string
	// Sampler represents the sampler for tracing. The default value is 1.
	Sampler      float64
	Batcher      KindOtlp
	BatchTimeout time.Duration
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
		Name:         TraceName,
		Endpoint:     "http://localhost:4318",
		Sampler:      1,
		Batcher:      KindOtlpHttp,
		BatchTimeout: 5 * time.Second,
		OtlpHeaders:  map[string]string{},
	}
}
