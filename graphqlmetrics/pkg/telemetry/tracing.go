package telemetry

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
)

const (
	// WithEndpoint respects the following environment variables:
	// OTEL_EXPORTER_OTLP_ENDPOINT
	// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
	DefaultGrpcTelemetryEndpoint = "cosmo-otel.wundergraph.com"
)

func buildResourceOptions() resource.Option {
	return resource.WithAttributes(
		attribute.String("wg.component.name", DefaultServerName),
		attribute.String("wg.component.version", serviceVersion),
	)
}

func newOtlpTraceGrpcClient() otlptrace.Client {
	return otlptracegrpc.NewClient(
		otlptracegrpc.WithEndpoint(DefaultGrpcTelemetryEndpoint),
		otlptracegrpc.WithCompressor("gzip"),
	)
}

func newTraceExporter() (*otlptrace.Exporter, error) {
	return otlptrace.New(
		context.Background(),
		newOtlpTraceGrpcClient(),
	)
}

func (c *Config) NewTracerProvider() (*sdktrace.TracerProvider, error) {
	exporter, err := newTraceExporter()
	if err != nil {
		return nil, err
	}

	resources, err := resource.New(
		context.Background(),
		buildResourceOptions(),
	)

	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(sdktrace.NewBatchSpanProcessor(exporter)),
		sdktrace.WithSyncer(exporter),
		sdktrace.WithResource(resources),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	return tp, err
}
