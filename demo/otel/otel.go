package otel

import (
	"context"
	"errors"
	"log"
	"os"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.20.0"
)

const defaultOtelEndpoint = "localhost:4318"

type Options struct {
	// ServiceName contains the service name for telemetry. It must be non-empty.
	ServiceName string
	// IsProduction indicates whether we're running in production mode. If nil,
	// the value is determined by checking if the ENV environment variable equals
	// "production"
	IsProduction *bool
	// Endpoint for the OTEL server. If empty, it's read from the OTEL_HTTP_ENDPOINT
	// environment variable, defaulting to localhost:4318 if not provided
	Endpoint string
	// AuthToken indicates the token for authenticating with the OTEL server. If empty, the value of the
	// OTEL_AUTH_TOKEN environment variable is used instead
	AuthToken string
}

func InitTracing(ctx context.Context, otelOpts Options) error {
	if otelOpts.ServiceName == "" {
		return errors.New("ServiceName is empty")
	}
	otelHttpEndpoint := otelOpts.Endpoint
	if otelHttpEndpoint == "" {
		otelHttpEndpoint = os.Getenv("OTEL_HTTP_ENDPOINT")
		if otelHttpEndpoint == "" {
			otelHttpEndpoint = defaultOtelEndpoint
		}
	}
	otelAuthToken := otelOpts.AuthToken
	if otelAuthToken == "" {
		otelAuthToken = os.Getenv("OTEL_AUTH_TOKEN")
	}

	var opts []otlptracehttp.Option

	isProduction := otelOpts.IsProduction
	if isProduction == nil {
		isProd := os.Getenv("ENV") == "production"
		isProduction = &isProd
	}

	if !*isProduction {
		opts = append(opts, otlptracehttp.WithInsecure())
	}

	if otelAuthToken != "" {
		opts = append(opts, otlptracehttp.WithHeaders(map[string]string{
			"Authorization": "Bearer " + otelAuthToken,
		}))
	}

	opts = append(opts,
		otlptracehttp.WithEndpoint(otelHttpEndpoint),
		otlptracehttp.WithURLPath("/v1/traces"),
	)

	traceExporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		log.Fatalf("failed to initialize stdouttrace export pipeline: %v", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithBatcher(traceExporter, sdktrace.WithBatchTimeout(100*time.Millisecond)),
		sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceNameKey.String(otelOpts.ServiceName))),
		sdktrace.WithSampler(
			sdktrace.ParentBased(sdktrace.AlwaysSample()),
		),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return nil
}
