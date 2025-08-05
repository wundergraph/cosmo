package config

import sdktrace "go.opentelemetry.io/otel/sdk/trace"

type RouterPluginConfig struct {
	ServiceName         string
	ServiceVersion      string
	TracingEnabled      bool
	TracingErrorHandler func(err error)

	// This should only be used for testing purposes
	MemoryExporter sdktrace.SpanExporter
}
