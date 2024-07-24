package telemetry

import (
	"context"

	rmetric "github.com/wundergraph/cosmo/router/pkg/metric"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
)

const (
	DefaultServerName = "cosmo-graphqlmetrics"
	serviceVersion    = "dev"
)

// NewTelemetryConfig creates a rmetric.Config without the OTEL export enabled
// this is done to reuse the config from the cosmo-router which is already
// implementing OTEL data
func NewTelemetryConfig(prometheusConfig rmetric.PrometheusConfig) *rmetric.Config {
	return &rmetric.Config{
		Name:       DefaultServerName,
		Version:    serviceVersion,
		Prometheus: prometheusConfig,
	}
}

func InitTracer() (*sdktrace.TracerProvider, error) {
	// Create stdout exporter to be able to retrieve
	// the collected spans.
	exporter, err := stdouttrace.New(stdouttrace.WithPrettyPrint())
	if err != nil {
		return nil, err
	}

	// For the demonstration, use sdktrace.AlwaysSample sampler to sample all traces.
	// In a production application, use sdktrace.ProbabilitySampler with a desired probability.
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(semconv.SchemaURL, semconv.ServiceName("ExampleService"))),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp, err
}

func InitMeter() (*prometheus.Exporter, func(context.Context) error) {
	exporter, err := prometheus.New()
	if err != nil {
		panic(err)
	}

	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(exporter),
		sdkmetric.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String("example-service"),
		)),
	)
	otel.SetMeterProvider(mp)
	return exporter, mp.Shutdown
}
