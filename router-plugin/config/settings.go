package config

import "time"

type (
	ExporterProtocolType string
	ExporterTemporality  string
	Propagator           string
)

type IPAnonymizationMethod string

const (
	Hash   IPAnonymizationMethod = "hash"
	Redact IPAnonymizationMethod = "redact"
)

const (
	ExporterOLTPHTTP ExporterProtocolType = "http"
	ExporterOLTPGRPC ExporterProtocolType = "grpc"
)

const (
	PropagatorTraceContext Propagator = "tracecontext"
	PropagatorB3           Propagator = "b3"
	PropagatorJaeger       Propagator = "jaeger"
	PropagatorBaggage      Propagator = "baggage"
	PropagatorDatadog      Propagator = "datadog"
)

// StartupConfig contains the configuration passed from the router.
type StartupConfig struct {
	Telemetry       *Telemetry       `json:"telemetry,omitempty"`
	IPAnonymization *IPAnonymization `json:"ip_anonymization,omitempty"`
}

type Telemetry struct {
	Tracing *Tracing `json:"tracing,omitempty"`
}

type Tracing struct {
	Exporters   []Exporter   `json:"exporters,omitempty"`
	Propagators []Propagator `json:"propagators,omitempty"`
	Sampler     float64      `json:"sampler"`
}

type Exporter struct {
	Endpoint      string               `json:"endpoint"`
	Exporter      ExporterProtocolType `json:"exporter"`
	BatchTimeout  time.Duration        `json:"batch_timeout"`
	ExportTimeout time.Duration        `json:"export_timeout"`
	Headers       map[string]string    `json:"headers"`
	HTTPPath      string               `json:"http_path"`
}

type IPAnonymization struct {
	Enabled bool                  `json:"enabled"`
	Method  IPAnonymizationMethod `json:"method"`
}
