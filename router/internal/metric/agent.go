package metric

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.21.0"
	"go.uber.org/zap"
	_ "google.golang.org/grpc/encoding/gzip" // Required for gzip support over grpc
)

var (
	mp *sdkmetric.MeterProvider
)

const (
	defaultExportTimeout  = 30 * time.Second
	defaultExportInterval = 15 * time.Second
)

// StartAgent starts an opentelemetry metric agent.
func StartAgent(ctx context.Context, log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	return startAgent(ctx, log, c)
}

func createPromExporter() (*prometheus.Exporter, error) {
	prometheusExporter, err := prometheus.New(prometheus.WithoutUnits())
	if err != nil {
		return nil, err
	}
	return prometheusExporter, nil
}

func createOTELExporter(log *zap.Logger, exp *OpenTelemetryExporter) (sdkmetric.Exporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint %q: %w", exp.Endpoint, err)
	}
	// Use delta temporalities for counters, gauge and histograms
	// Delta temporalities are reported as completed intervals. They don't build upon each other.
	// This makes queries easier and reduce the amount of data to be transferred because the SDK
	// client will aggregate the data before sending it to the collector.
	temporalitySelector := func(kind sdkmetric.InstrumentKind) metricdata.Temporality {
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
	}
	var exporter sdkmetric.Exporter
	switch exp.Exporter {
	case otelconfig.ExporterDefault, otelconfig.ExporterOLTPHTTP:
		opts := []otlpmetrichttp.Option{
			// Includes host and port
			otlpmetrichttp.WithEndpoint(u.Host),
			otlpmetrichttp.WithCompression(otlpmetrichttp.GzipCompression),
			otlpmetrichttp.WithTemporalitySelector(temporalitySelector),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlpmetrichttp.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlpmetrichttp.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			opts = append(opts, otlpmetrichttp.WithURLPath(exp.HTTPPath))
		}

		exporter, err = otlpmetrichttp.New(
			context.Background(),
			opts...,
		)
	case otelconfig.ExporterOLTPGRPC:
		opts := []otlpmetricgrpc.Option{
			// Includes host and port
			otlpmetricgrpc.WithEndpoint(u.Host),
			otlpmetricgrpc.WithCompressor("gzip"),
			otlpmetricgrpc.WithTemporalitySelector(temporalitySelector),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlpmetricgrpc.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlpmetricgrpc.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			log.Warn("Otlpmetricgrpc exporter doesn't support arbitrary paths", zap.String("path", exp.HTTPPath))
		}

		exporter, err = otlpmetricgrpc.New(
			context.Background(),
			opts...,
		)
	default:
		return nil, fmt.Errorf("unknown metrics exporter %s", exp.Exporter)
	}
	if err != nil {
		return nil, err
	}
	log.Info("Metrics enabled", zap.String("exporter", string(exp.Exporter)), zap.String("endpoint", exp.Endpoint), zap.String("path", exp.HTTPPath))
	return exporter, nil
}

func startAgent(ctx context.Context, log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(c.Name)),
		resource.WithProcessPID(),
		resource.WithTelemetrySDK(),
		resource.WithHost(),
	)
	if err != nil {
		return nil, err
	}

	opts := []sdkmetric.Option{
		// Record information about this application in a Resource.
		sdkmetric.WithResource(r),
	}

	if c.OpenTelemetry.Enabled {
		for _, exp := range c.OpenTelemetry.Exporters {
			exporter, err := createOTELExporter(log, exp)
			if err != nil {
				log.Error("creating OTEL metrics exporter", zap.Error(err))
				return nil, err
			}

			// Please version this meter name if you change the buckets.

			msBucketHistogram := metric.AggregationExplicitBucketHistogram{
				// 0ms-10s
				Boundaries: []float64{
					0, 5, 7, 10, 15, 25, 50, 75, 100, 125, 150, 175, 200, 225,
					250, 275, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1250,
					1500, 1750, 2000, 2250, 2500, 2750, 3000, 3500, 4000, 5000, 10000,
				},
			}
			bytesBucketHistogram := metric.AggregationExplicitBucketHistogram{
				// 0kb-20MB
				Boundaries: []float64{
					0, 50, 100, 300, 500, 1000, 3000, 5000, 10000, 15000,
					30000, 50000, 70000, 90000, 150000, 300000, 600000,
					800000, 1000000, 5000000, 10000000, 20000000,
				},
			}

			opts = append(opts,
				sdkmetric.WithView(sdkmetric.NewView(
					sdkmetric.Instrument{
						Unit:  unitMilliseconds,
						Scope: instrumentation.Scope{Name: cosmoRouterMeterName},
					},
					sdkmetric.Stream{
						Aggregation: msBucketHistogram,
					},
				)),
				sdkmetric.WithView(sdkmetric.NewView(
					sdkmetric.Instrument{
						Unit:  unitBytes,
						Scope: instrumentation.Scope{Name: cosmoRouterMeterName},
					},
					sdkmetric.Stream{
						Aggregation: bytesBucketHistogram,
					},
				)),
				sdkmetric.WithReader(
					sdkmetric.NewPeriodicReader(exporter,
						sdkmetric.WithTimeout(defaultExportTimeout),
						sdkmetric.WithInterval(defaultExportInterval),
					),
				))
		}
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
