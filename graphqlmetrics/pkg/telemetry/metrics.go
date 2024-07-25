package telemetry

import (
	"context"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
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

func (c *Config) NewPrometheusMeterProvider() (*sdkmetric.MeterProvider, *prometheus.Registry, error) {
	var registry *prometheus.Registry

	if c.Prometheus.TestRegistry != nil {
		registry = c.Prometheus.TestRegistry
	} else {
		registry = prometheus.NewRegistry()
	}

	registry.MustRegister(collectors.NewGoCollector())

	// Only available on Linux and Windows systems
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	promExporter, err := otelprom.New(
		otelprom.WithoutUnits(),
		otelprom.WithRegisterer(registry),
	)

	if err != nil {
		panic(err)
	}

	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(promExporter),
		sdkmetric.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String(c.Name),
		)),
	)

	otel.SetMeterProvider(mp)
	return mp, registry, nil
}
