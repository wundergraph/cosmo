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
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.uber.org/zap"
	_ "google.golang.org/grpc/encoding/gzip" // Required for gzip support over grpc
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

func createOTELExporter(log *zap.Logger, exp *OpenTelemetryExporter) (sdkmetric.Exporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint %q: %w", exp.Endpoint, err)
	}
	var exporter sdkmetric.Exporter
	switch exp.Exporter {
	case otelconfig.ExporterDefault, otelconfig.ExporterOLTPHTTP:
		opts := []otlpmetrichttp.Option{
			// Includes host and port
			otlpmetrichttp.WithEndpoint(u.Host),
			otlpmetrichttp.WithCompression(otlpmetrichttp.GzipCompression),
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
		}

		if u.Scheme != "https" {
			opts = append(opts, otlpmetricgrpc.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlpmetricgrpc.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			log.Warn("otlpmetricgrpc exporter doesn't support arbitrary paths", zap.String("path", exp.HTTPPath))
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
	log.Info("using metrics exporter", zap.String("exporter", string(exp.Exporter)), zap.String("endpoint", exp.Endpoint), zap.String("path", exp.HTTPPath))
	return exporter, nil
}

func startAgent(log *zap.Logger, c *Config) (*sdkmetric.MeterProvider, error) {
	opts := []sdkmetric.Option{
		// Record information about this application in a Resource.
		sdkmetric.WithResource(resource.NewSchemaless(semconv.ServiceNameKey.String(c.Name))),
	}

	if c.OpenTelemetry.Enabled {
		for _, exp := range c.OpenTelemetry.Exporters {
			exporter, err := createOTELExporter(log, exp)
			if err != nil {
				log.Error("creating OTEL metrics exporter", zap.Error(err))
				return nil, err
			}

			opts = append(opts,
				sdkmetric.WithReader(
					sdkmetric.NewPeriodicReader(exporter,
						sdkmetric.WithTimeout(30*time.Second),
						sdkmetric.WithInterval(30*time.Second),
					),
				),
			)
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
