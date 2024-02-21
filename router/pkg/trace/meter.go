package trace

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/otel/otelconfig"
	"github.com/wundergraph/cosmo/router/pkg/trace/redact"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.20.0"
	"go.uber.org/zap"
	"net/url"

	_ "google.golang.org/grpc/encoding/gzip" // Required for gzip support over grpc
)

var (
	tp *sdktrace.TracerProvider
)

type (
	IPAnonymizationConfig struct {
		Enabled bool
		Method  string
	}

	ProviderConfig struct {
		Logger            *zap.Logger
		Config            *Config
		ServiceInstanceID string
		IPAnonymization   *IPAnonymizationConfig
	}
)

func createExporter(log *zap.Logger, exp *Exporter) (sdktrace.SpanExporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
	}
	var exporter sdktrace.SpanExporter
	// Just support OTLP and gRPC for now. Jaeger has native OTLP support.
	switch exp.Exporter {
	case otelconfig.ExporterOLTPHTTP:
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

func NewTracerProvider(ctx context.Context, config *ProviderConfig) (*sdktrace.TracerProvider, error) {
	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(config.Config.Name)),
		resource.WithAttributes(semconv.ServiceVersionKey.String(config.Config.Version)),
		resource.WithAttributes(semconv.ServiceInstanceID(config.ServiceInstanceID)),
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
		sdktrace.WithSampler(
			sdktrace.ParentBased(
				sdktrace.TraceIDRatioBased(config.Config.Sampler),
				// By default, when the parent span is sampled, the child span will be sampled.
			),
		),
		// Record information about this application in a Resource.
		sdktrace.WithResource(r),
	}

	if config.IPAnonymization != nil && config.IPAnonymization.Enabled {

		var rFunc redact.RedactFunc

		if config.IPAnonymization.Method == "hash" {
			rFunc = func(key attribute.KeyValue) string {
				h := sha256.New()
				return string(h.Sum([]byte(key.Value.AsString())))
			}
		} else if config.IPAnonymization.Method == "redact" {
			rFunc = func(key attribute.KeyValue) string {
				return "[REDACTED]"
			}

		}

		opts = append(opts, redact.Attributes(SensitiveAttributes, rFunc))
	}

	if len(config.Config.Propagators) > 0 {
		propagators, err := NewCompositePropagator(config.Config.Propagators...)
		if err != nil {
			config.Logger.Error("creating propagators", zap.Error(err))
			return nil, err
		}
		otel.SetTextMapPropagator(propagators)
	}

	if config.Config.Enabled {
		for _, exp := range config.Config.Exporters {
			if exp.Disabled {
				continue
			}

			// Default to OLTP HTTP
			if exp.Exporter == "" {
				exp.Exporter = otelconfig.ExporterOLTPHTTP
			}

			exporter, err := createExporter(config.Logger, exp)
			if err != nil {
				config.Logger.Error("creating exporter", zap.Error(err))
				return nil, err
			}

			batchTimeout := exp.BatchTimeout
			if batchTimeout == 0 {
				batchTimeout = DefaultBatchTimeout
			}

			exportTimeout := exp.ExportTimeout
			if exportTimeout == 0 {
				exportTimeout = DefaultExportTimeout
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
		config.Logger.Error("otel error", zap.Error(err))
	}))

	return tp, nil
}
