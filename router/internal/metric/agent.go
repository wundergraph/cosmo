package metric

import (
	"context"
	"fmt"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/prometheus"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.uber.org/zap"
	"net/url"
	"time"
)

var (
	mp *sdkmetric.MeterProvider
)

// StartAgent starts an opentelemetry metric agent.
func StartAgent(ctx context.Context, log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	return startAgent(ctx, log, c)
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
		otlpmetrichttp.WithCompression(otlpmetrichttp.GzipCompression),
		// Use delta temporalities for counters, gauge and histograms
		// Delta temporalities are reported as completed intervals. They don't build upon each other.
		// This makes queries easier and reduce the amount of data to be transferred because the SDK
		// client will aggregate the data before sending it to the collector.
		otlpmetrichttp.WithTemporalitySelector(func(kind sdkmetric.InstrumentKind) metricdata.Temporality {
			switch kind {
			case sdkmetric.InstrumentKindCounter,
				sdkmetric.InstrumentKindHistogram,
				sdkmetric.InstrumentKindObservableGauge,
				sdkmetric.InstrumentKindObservableCounter:
				return metricdata.DeltaTemporality
			case sdkmetric.InstrumentKindUpDownCounter,
				sdkmetric.InstrumentKindObservableUpDownCounter:
				return metricdata.DeltaTemporality
			}
			panic("unknown instrument kind")
		}),
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

func startAgent(ctx context.Context, log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(c.Name)),
		resource.WithProcessPID(),
		resource.WithFromEnv(),
		resource.WithHostID(),
		resource.WithHost(),
	)
	if err != nil {
		return nil, err
	}

	opts := []sdkmetric.Option{
		// Record information about this application in a Resource.
		sdkmetric.WithResource(r),
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
					sdkmetric.WithInterval(5*time.Second),
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
