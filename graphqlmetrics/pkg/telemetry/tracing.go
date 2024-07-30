package telemetry

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/url"

	"github.com/wundergraph/cosmo/router/pkg/trace/redact"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.uber.org/zap"
)

func (c *Config) NewTracerProvider(ctx context.Context) (*sdktrace.TracerProvider, error) {
	providerConfig := c.OpenTelemetry.Config
	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(c.Name)),
		resource.WithAttributes(semconv.ServiceVersionKey.String(c.Version)),
		resource.WithAttributes(semconv.ServiceInstanceID(providerConfig.ServiceInstanceID)),
		resource.WithAttributes(c.ResourceAttributes...),
		resource.WithProcessPID(),
		resource.WithOSType(),
		resource.WithTelemetrySDK(),
		resource.WithHost(),
	)
	if err != nil {
		return nil, err
	}
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
		// Record information about this application in a Resource.
		sdktrace.WithResource(r),
	}

	if providerConfig.IPAnonymization != nil && providerConfig.IPAnonymization.Enabled {
		var rFunc redact.RedactFunc

		if providerConfig.IPAnonymization.Method == Hash {
			rFunc = func(key attribute.KeyValue) string {
				h := sha256.New()
				return string(h.Sum([]byte(key.Value.AsString())))
			}
		} else if providerConfig.IPAnonymization.Method == Redact {
			rFunc = func(key attribute.KeyValue) string {
				return "[REDACTED]"
			}

		}

		opts = append(opts, redact.Attributes(SensitiveAttributes, rFunc))
	}

	if providerConfig.MemoryExporter != nil {
		opts = append(opts, sdktrace.WithSyncer(providerConfig.MemoryExporter))
	} else {
		for _, exp := range c.OpenTelemetry.Exporters {
			if exp.Disabled {
				continue
			}

			exporter, err := createExporter(providerConfig.Logger, exp)
			if err != nil {
				return nil, err
			}

			batchTimeout := exp.BatchTimeout
			if batchTimeout == 0 {
				batchTimeout = DefaultBatchTimeout
			}

			exportTimeout := exp.ExportTimeout
			if batchTimeout == 0 {
				exportTimeout = DefaultExportTimeout
			}

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

	tp := sdktrace.NewTracerProvider(
		opts...,
	)

	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	return tp, err
}

func createExporter(log *zap.Logger, exp *OpenTelemetryExporter) (sdktrace.SpanExporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
	}
	var exporter sdktrace.SpanExporter
	// Just support OTLP and gRPC for now. Jaeger has native OTLP support.
	switch exp.Exporter {
	case ExporterOLTPHTTP:
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
	case ExporterOLTPGRPC:
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
			log.Warn("Otlptracegrpc exporter doesn't support arbitrary paths", zap.String("path", exp.HTTPPath))
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

	log.Info("Tracer enabled", zap.String("exporter", string(exp.Exporter)), zap.String("endpoint", exp.Endpoint), zap.String("path", exp.HTTPPath))

	return exporter, nil
}
