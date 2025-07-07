package tracing

import (
	"context"
	"encoding/json"
	"fmt"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"net/url"
	"os"
	"time"
)

type TracingOptions struct {
	ServiceName    string
	ServiceVersion string
}

type Exporter string
type ExporterTemporality string

const (
	ExporterOLTPHTTP Exporter = "http"
	ExporterOLTPGRPC Exporter = "grpc"

	DefaultBatchTimeout  = 10 * time.Second
	DefaultExportTimeout = 30 * time.Second

	SampleRate = 1.0
)

type OpenTelemetryExporter struct {
	Endpoint string

	Exporter      Exporter
	BatchTimeout  time.Duration
	ExportTimeout time.Duration
	Headers       map[string]string
	HTTPPath      string
}

func initTracer(ctx context.Context, optParams TracingOptions) (*sdktrace.TracerProvider, error) {
	var exporters []*OpenTelemetryExporter
	if exporterConfig := os.Getenv("router_exporter_config"); exporterConfig != "" {
		err := json.Unmarshal([]byte(exporterConfig), &exporters)
		if err != nil {
			return nil, err
		}
	}

	// Return no-op provider
	if len(exporters) == 0 {
		provider := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample()))
		otel.SetTracerProvider(provider)
		return provider, nil
	}

	r, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceNameKey.String(optParams.ServiceName)),
		resource.WithAttributes(semconv.ServiceVersionKey.String(optParams.ServiceVersion)),
		resource.WithAttributes(attribute.Key("wg.is_plugin").Bool(true)),
		resource.WithProcessPID(),
		resource.WithOSType(),
		resource.WithTelemetrySDK(),
		resource.WithHost(),
	)
	if err != nil {
		return nil, err
	}

	opts := []sdktrace.TracerProviderOption{
		sdktrace.WithRawSpanLimits(sdktrace.SpanLimits{
			AttributeValueLengthLimit:   3 * 1024, // 3KB
			AttributeCountLimit:         sdktrace.DefaultAttributeCountLimit,
			EventCountLimit:             sdktrace.DefaultEventCountLimit,
			LinkCountLimit:              sdktrace.DefaultLinkCountLimit,
			AttributePerEventCountLimit: sdktrace.DefaultEventCountLimit,
			AttributePerLinkCountLimit:  sdktrace.DefaultAttributePerLinkCountLimit,
		}),
		sdktrace.WithResource(r),
	}

	opts = append(opts,
		sdktrace.WithSampler(
			sdktrace.ParentBased(
				sdktrace.TraceIDRatioBased(SampleRate),
			),
		),
	)

	for _, exp := range exporters {
		// Default to OLTP HTTP
		if exp.Exporter == "" {
			exp.Exporter = ExporterOLTPHTTP
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

	// Set global tracer provider
	tp := sdktrace.NewTracerProvider(opts...)

	otel.SetTracerProvider(tp)

	// Set global propagator for trace context propagation
	otel.SetTextMapPropagator(
		propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))

	return tp, nil
}

func createExporter(exp *OpenTelemetryExporter) (sdktrace.SpanExporter, error) {
	u, err := url.Parse(exp.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("invalid OpenTelemetry endpoint: %w", err)
	}

	// Just support OTLP and gRPC for now. Jaeger has native OTLP support.
	var exporter sdktrace.SpanExporter
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
