package trace

import (
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
	"net/http"
)

type TracingHandlerOpts struct {
	TraceConfig         *Config
	HealthCheckPath     string
	ReadinessCheckPath  string
	LivenessCheckPath   string
	CompositePropagator propagation.TextMapPropagator
	TracerProvider      *sdktrace.TracerProvider
	SpanNameFormatter   func(operation string, r *http.Request) string
}

func NewTracingHandler(s TracingHandlerOpts) func(next http.Handler) http.Handler {
	if !s.TraceConfig.Enabled {
		return nil
	}
	
	spanStartOptions := []oteltrace.SpanStartOption{
		oteltrace.WithAttributes(
			otel.RouterServerAttribute,
			otel.WgRouterRootSpan.Bool(true),
		),
	}

	if s.TraceConfig.WithNewRoot {
		spanStartOptions = append(spanStartOptions, oteltrace.WithNewRoot())
	}

	middlewareOptions := []otelhttp.Option{
		otelhttp.WithSpanOptions(spanStartOptions...),
		otelhttp.WithFilter(CommonRequestFilter),
		otelhttp.WithFilter(PrefixRequestFilter(
			[]string{s.HealthCheckPath, s.ReadinessCheckPath, s.LivenessCheckPath}),
		),
		// Disable built-in metricStore through NoopMeterProvider
		otelhttp.WithMeterProvider(sdkmetric.NewMeterProvider()),
		otelhttp.WithSpanNameFormatter(s.SpanNameFormatter),
		otelhttp.WithTracerProvider(s.TracerProvider),
	}

	if s.CompositePropagator != nil {
		middlewareOptions = append(middlewareOptions, otelhttp.WithPropagators(s.CompositePropagator))
	}

	traceHandler := NewMiddleware(
		WithTracePreHandler(
			func(r *http.Request, w http.ResponseWriter) {
				traceID := GetTraceID(r.Context())
				if s.TraceConfig.ResponseTraceHeader.Enabled {
					w.Header().Set(s.TraceConfig.ResponseTraceHeader.HeaderName, traceID)
				}
			}),
		WithOtelHttp(middlewareOptions...),
	)

	return traceHandler.Handler
}
