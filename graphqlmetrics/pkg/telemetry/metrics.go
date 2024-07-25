package telemetry

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"

	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
)

func (c *Config) NewTracerProvider() (*sdktrace.TracerProvider, error) {
	exporter, err := stdouttrace.New(stdouttrace.WithPrettyPrint())
	if err != nil {
		return nil, err
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(semconv.SchemaURL, semconv.ServiceName(c.Name))),
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
