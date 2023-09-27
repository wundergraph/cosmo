package trace

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/wundergraph/cosmo/router/internal/otel/otelconfig"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.uber.org/zap"

	_ "google.golang.org/grpc/encoding/gzip" // Required for gzip support over grpc
)

const (
	defaultBatchTimeout  = 10 * time.Second
	defaultExportTimeout = 30 * time.Second
)

var (
	tp *sdktrace.TracerProvider
)

// StartAgent starts an opentelemetry agent.
func StartAgent(log *zap.Logger, c *Config) (*sdktrace.TracerProvider, error) {
	return startAgent(log, c)
}

func createExporter(log *zap.Logger, exp *Exporter) (sdktrace.SpanExporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
	}
	var exporter sdktrace.SpanExporter
	// Just support OTLP and gRPC for now. Jaeger has native OTLP support.
	switch exp.Exporter {
	case otelconfig.ExporterDefault, otelconfig.ExporterOLTPHTTP:
		opts := []otlptracehttp.Option{
			// Includes host and port
			otlptracehttp.WithEndpoint(u.Host),
			otlptracehttp.WithCompression(otlptracehttp.GzipCompression),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlptracehttp.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlptracehttp.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			opts = append(opts, otlptracehttp.WithURLPath(exp.HTTPPath))
		}
		exporter, err = otlptracehttp.New(
			context.Background(),
			opts...,
		)
	case otelconfig.ExporterOLTPGRPC:
		opts := []otlptracegrpc.Option{
			// Includes host and port
			otlptracegrpc.WithEndpoint(u.Host),
			otlptracegrpc.WithCompressor("gzip"),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlptracegrpc.WithInsecure())
		}

		if len(exp.Headers) > 0 {
			opts = append(opts, otlptracegrpc.WithHeaders(exp.Headers))
		}
		if len(exp.HTTPPath) > 0 {
			log.Warn("otlptracegrpc exporter doesn't support arbitrary paths", zap.String("path", exp.HTTPPath))
		}
		exporter, err = otlptracegrpc.New(
			context.Background(),
			opts...,
		)
	default:
		return nil, fmt.Errorf("unknown exporter type: %s", exp.Exporter)
	}
	if err != nil {
		return nil, err
	}
	log.Info("using trace exporter", zap.String("exporter", string(exp.Exporter)), zap.String("endpoint", exp.Endpoint), zap.String("path", exp.HTTPPath))
	return exporter, nil
}

func startAgent(log *zap.Logger, c *Config) (*sdktrace.TracerProvider, error) {
	opts := []sdktrace.TracerProviderOption{
		// Set the sampling rate based on the parent span to 100%
		sdktrace.WithRawSpanLimits(sdktrace.SpanLimits{
			// Avoid misuse of attributes.
			AttributeValueLengthLimit: 3 * 1024, // 3KB
			// Based on the default values from the OpenTelemetry specification.
			AttributeCountLimit:         sdktrace.DefaultAttributeCountLimit,
			EventCountLimit:             sdktrace.DefaultEventCountLimit,
			LinkCountLimit:              sdktrace.DefaultLinkCountLimit,
			AttributePerEventCountLimit: sdktrace.DefaultEventCountLimit,
			AttributePerLinkCountLimit:  sdktrace.DefaultAttributePerLinkCountLimit,
		}),
		sdktrace.WithSampler(
			sdktrace.ParentBased(
				sdktrace.TraceIDRatioBased(c.Sampler),
				// By default, when the parent span is sampled, the child span will be sampled.
			),
		),
		// Record information about this application in a Resource.
		sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceNameKey.String(c.Name))),
	}

	if c.Enabled {
		for _, exp := range c.Exporters {
			exporter, err := createExporter(log, exp)
			if err != nil {
				log.Error("creating exporter", zap.Error(err))
				return nil, err
			}

			batchTimeout := exp.BatchTimeout
			if batchTimeout == 0 {
				batchTimeout = defaultBatchTimeout
			}

			exportTimeout := exp.ExportTimeout
			if exportTimeout == 0 {
				exportTimeout = defaultExportTimeout
			}

			// Always be sure to batch in production.
			opts = append(opts,
				sdktrace.WithBatcher(exporter,
					sdktrace.WithBatchTimeout(batchTimeout),
					sdktrace.WithExportTimeout(exportTimeout),
					sdktrace.WithMaxExportBatchSize(512),
					sdktrace.WithMaxQueueSize(2048),
				),
			)
		}
	}

	tp := sdktrace.NewTracerProvider(opts...)
	// Set the global TraceProvider to the SDK tracer provider.
	otel.SetTracerProvider(tp)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		log.Error("otel error", zap.Error(err))
	}))

	return tp, nil
}
