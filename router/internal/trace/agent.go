package trace

import (
	"context"
	"fmt"
	"net/url"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.uber.org/zap"
)

type KindOtlp string

const (
	KindOtlpHttp KindOtlp = "otlphttp"
)

var (
	tp *sdktrace.TracerProvider
)

// StartAgent starts an opentelemetry agent.
func StartAgent(ctx context.Context, log *zap.Logger, c *Config) (*sdktrace.TracerProvider, error) {
	return startAgent(ctx, log, c)
}

func createExporter(c *Config) (sdktrace.SpanExporter, error) {
	// Just support OTLP for now. Jaeger has native OTLP support.
	switch c.Batcher {
	case KindOtlpHttp:
		u, err := url.Parse(c.Endpoint)
		if err != nil {
			return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
		}

		opts := []otlptracehttp.Option{
			// Includes host and port
			otlptracehttp.WithEndpoint(u.Host),
			otlptracehttp.WithCompression(otlptracehttp.GzipCompression),
		}

		if u.Scheme != "https" {
			opts = append(opts, otlptracehttp.WithInsecure())
		}

		if len(c.OtlpHeaders) > 0 {
			opts = append(opts, otlptracehttp.WithHeaders(c.OtlpHeaders))
		}
		if len(c.OtlpHttpPath) > 0 {
			opts = append(opts, otlptracehttp.WithURLPath(c.OtlpHttpPath))
		}
		return otlptracehttp.New(
			context.Background(),
			opts...,
		)
	default:
		return nil, fmt.Errorf("unknown exporter: %s", c.Batcher)
	}
}

func startAgent(ctx context.Context, log *zap.Logger, c *Config) (*sdktrace.TracerProvider, error) {
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
		sdktrace.WithResource(r),
	}

	if c.Enabled && len(c.Endpoint) > 0 {
		exp, err := createExporter(c)
		if err != nil {
			log.Error("create exporter error", zap.Error(err))
			return nil, err
		}

		// Always be sure to batch in production.
		opts = append(opts,
			sdktrace.WithBatcher(exp,
				sdktrace.WithBatchTimeout(c.BatchTimeout),
				sdktrace.WithExportTimeout(c.ExportTimeout),
				sdktrace.WithMaxExportBatchSize(512),
				sdktrace.WithMaxQueueSize(2048),
			),
		)

		log.Info("Trace Exporter agent started", zap.String("url", c.Endpoint+c.OtlpHttpPath))
	}

	tp := sdktrace.NewTracerProvider(opts...)
	// Set the global TraceProvider to the SDK tracer provider.
	otel.SetTracerProvider(tp)
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(err error) {
		log.Error("otel error", zap.Error(err))
	}))

	return tp, nil
}
