package grpccommon

import (
	"time"
)

type GRPCStartupParams struct {
	Telemetry       *GRPCTelemetry       `json:"telemetry,omitempty"`
	IPAnonymization *GRPCIPAnonymization `json:"ip_anonymization,omitempty"`
}
type GRPCTelemetry struct {
	Tracing *GRPCTracing `json:"tracing,omitempty"`
}
type GRPCTracing struct {
	Exporters   []GRPCExporter `json:"exporters,omitempty"`
	Propagators []string       `json:"propagators,omitempty"`
	Sampler     float64        `json:"sampler"`
}
type GRPCExporter struct {
	Endpoint      string            `json:"endpoint"`
	Exporter      string            `json:"exporter"`
	BatchTimeout  time.Duration     `json:"batch_timeout"`
	ExportTimeout time.Duration     `json:"export_timeout"`
	Headers       map[string]string `json:"headers"`
	HTTPPath      string            `json:"http_path"`
}

type GRPCIPAnonymization struct {
	Enabled bool   `json:"enabled"`
	Method  string `json:"method"`
}
