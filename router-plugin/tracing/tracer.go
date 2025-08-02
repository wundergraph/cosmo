package tracing

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"github.com/wundergraph/cosmo/router-plugin/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.20.0"
	"net/url"
	"time"
)

type TracingOptions struct {
	ServiceName      string
	ServiceVersion   string
	ErrorHandlerFunc func(err error)
	TracingConfig    *config.Tracing
	IPAnonymization  *config.IPAnonymization
	MemoryExporter   sdktrace.SpanExporter
}

const (
	DefaultBatchTimeout  = 10 * time.Second
	DefaultExportTimeout = 30 * time.Second

	WgIsPlugin = attribute.Key("wg.is_plugin")
)

func initTracer(
	ctx context.Context,
	tracingConfig TracingOptions,
) (*sdktrace.TracerProvider, error) {
	// Return no-op provider
	if len(tracingConfig.TracingConfig.Exporters) == 0 {
		provider := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample()))
		otel.SetTracerProvider(provider)
		return provider, nil
	}

	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(tracingConfig.ServiceName)),
		resource.WithAttributes(semconv.ServiceVersionKey.String(tracingConfig.ServiceVersion)),
		resource.WithAttributes(WgIsPlugin.Bool(true)),
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

	opts = append(opts,
		sdktrace.WithSampler(
			sdktrace.ParentBased(
				sdktrace.TraceIDRatioBased(tracingConfig.TracingConfig.Sampler),
			),
		),
	)

	if tracingConfig.IPAnonymization != nil && tracingConfig.IPAnonymization.Enabled {
		var rFunc RedactFunc
		switch tracingConfig.IPAnonymization.Method {
		case config.Hash:
			rFunc = func(key attribute.KeyValue) string {
				h := sha256.New()
				h.Write([]byte(key.Value.AsString()))
				return hex.EncodeToString(h.Sum(nil))
			}
		case config.Redact:
			rFunc = func(key attribute.KeyValue) string {
				return "[REDACTED]"
			}
		}
		// In case hash or redact was not used
		if rFunc != nil {
			opts = append(opts, Attributes(SensitiveAttributes, rFunc))
		}
	}

	if tracingConfig.MemoryExporter != nil {
		opts = append(opts, sdktrace.WithSyncer(tracingConfig.MemoryExporter))
	} else {
		for _, exp := range tracingConfig.TracingConfig.Exporters {
			// Default to OLTP HTTP
			if exp.Exporter == "" {
				exp.Exporter = config.ExporterOLTPHTTP
			}

			exporter, err := createExporter(exp)
			if err != nil {
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

	otel.SetTracerProvider(tp)

	propagators, err := buildPropagators(tracingConfig.TracingConfig.Propagators)
	if err != nil {
		return nil, err
	}
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagators...))

	if tracingConfig.ErrorHandlerFunc != nil {
		otel.SetErrorHandler(otel.ErrorHandlerFunc(tracingConfig.ErrorHandlerFunc))
	}

	return tp, nil
}

func createExporter(exp config.Exporter) (sdktrace.SpanExporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
	}

	var exporter sdktrace.SpanExporter
	// Just support OTLP and gRPC for now. Jaeger has native OTLP support.
	switch exp.Exporter {
	case config.ExporterOLTPHTTP:
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
	case config.ExporterOLTPGRPC:
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

	return exporter, nil
}
