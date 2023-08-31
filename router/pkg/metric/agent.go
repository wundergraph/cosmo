package metric

import (
	"context"
	"fmt"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/prometheus"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.uber.org/zap"
	"net/url"
	"time"
)

var (
	mp *sdkmetric.MeterProvider
)

// StartAgent starts an opentelemetry metric agent.
func StartAgent(log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	return startAgent(log, c)
}

func createPromExporter() (*prometheus.Exporter, error) {
	prometheusExporter, err := prometheus.New()
	if err != nil {
		return nil, err
	}
	return prometheusExporter, nil
}

func createHttpExporter(c *Config) (sdkmetric.Exporter, error) {
	u, err := url.Parse(c.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
	}

	opts := []otlpmetrichttp.Option{
		// Includes host and port
		otlpmetrichttp.WithEndpoint(u.Host),
	}

	if u.Scheme != "https" {
		opts = append(opts, otlpmetrichttp.WithInsecure())
	}

	if len(c.OtlpHeaders) > 0 {
		opts = append(opts, otlpmetrichttp.WithHeaders(c.OtlpHeaders))
	}
	if len(c.OtlpHttpPath) > 0 {
		opts = append(opts, otlpmetrichttp.WithURLPath(c.OtlpHttpPath))
	}

	return otlpmetrichttp.New(
		context.Background(),
		opts...,
	)
}

func startAgent(log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	opts := []sdkmetric.Option{
		// Record information about this application in a Resource.
		sdkmetric.WithResource(resource.NewSchemaless(semconv.ServiceNameKey.String(c.Name))),
	}

	if c.Enabled && len(c.Endpoint) > 0 {
		exp, err := createHttpExporter(c)
		if err != nil {
			log.Error("create exporter error", zap.Error(err))
			return nil, err
		}

		opts = append(opts,
			sdkmetric.WithReader(
				sdkmetric.NewPeriodicReader(exp,
					sdkmetric.WithTimeout(30*time.Second),
					sdkmetric.WithInterval(30*time.Second),
				),
			),
		)

		log.Info("Metric Exporter agent started", zap.String("url", c.Endpoint+c.OtlpHttpPath))
	}

	if c.Prometheus.Enabled {
		promExp, err := createPromExporter()
		if err != nil {
			return nil, err
		}

		opts = append(opts, sdkmetric.WithReader(promExp))
	}

	mp = sdkmetric.NewMeterProvider(opts...)
	// Set the global MeterProvider to the SDK metric provider.
	otel.SetMeterProvider(mp)

	return mp, nil
}
