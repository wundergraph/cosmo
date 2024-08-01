package telemetry

import (
	"context"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	otelprom "go.opentelemetry.io/otel/exporters/prometheus"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdkresource "go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func (c *Config) NewPrometheusMeterProvider(ctx context.Context) (*sdkmetric.MeterProvider, *prometheus.Registry, error) {
	var registry *prometheus.Registry

	if c.Prometheus.TestRegistry != nil {
		registry = c.Prometheus.TestRegistry
	} else {
		registry = prometheus.NewRegistry()
	}

	// Default go process metrics
	registry.MustRegister(collectors.NewGoCollector())
	// Only available on Linux and Windows systems
	registry.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	promExporter, err := otelprom.New(
		otelprom.WithoutUnits(),
		otelprom.WithRegisterer(registry),
	)

	if err != nil {
		return nil, nil, err
	}

	resource, err := sdkresource.New(
		ctx,
		sdkresource.WithTelemetrySDK(),
		sdkresource.WithProcessPID(),
		sdkresource.WithOSType(),
		sdkresource.WithHost(),
		sdkresource.WithAttributes(
			semconv.ServiceVersionKey.String(c.Version),
			semconv.ServiceNameKey.String(c.Name),
		),
	)

	if err != nil {
		return nil, nil, err
	}

	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithReader(promExporter),
		sdkmetric.WithResource(resource),
	)

	return mp, registry, nil
}
