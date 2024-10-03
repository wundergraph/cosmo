package trace

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.4.0"
	"go.opentelemetry.io/otel/trace"
)

func TestTracerFromContext(t *testing.T) {
	traceFn := func(ctx context.Context, hasTraceId bool) {
		spanContext := trace.SpanContextFromContext(ctx)
		assert.Equal(t, spanContext.IsValid(), hasTraceId)
		parentTraceId := spanContext.TraceID().String()

		tracer := TracerFromContext(ctx)
		_, span := tracer.Start(ctx, "b")
		defer span.End()

		spanContext = span.SpanContext()
		assert.True(t, spanContext.IsValid())
		if hasTraceId {
			assert.Equal(t, parentTraceId, spanContext.TraceID().String())
		}

	}

	t.Run("context", func(t *testing.T) {
		opts := []sdktrace.TracerProviderOption{
			// Set the sampling rate based on the parent span to 100%
			sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(1))),
			// Record information about this application in a Resource.
			sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceNameKey.String("test"))),
		}
		tp = sdktrace.NewTracerProvider(opts...)
		otel.SetTracerProvider(tp)
		ctx, span := tp.Tracer(ServerName).Start(context.Background(), "a")

		defer span.End()
		traceFn(ctx, true)
	})

	t.Run("global", func(t *testing.T) {
		opts := []sdktrace.TracerProviderOption{
			// Set the sampling rate based on the parent span to 100%
			sdktrace.WithSampler(sdktrace.ParentBased(sdktrace.TraceIDRatioBased(1))),
			// Record information about this application in a Resource.
			sdktrace.WithResource(resource.NewSchemaless(semconv.ServiceNameKey.String("test"))),
		}
		tp = sdktrace.NewTracerProvider(opts...)
		otel.SetTracerProvider(tp)

		traceFn(context.Background(), false)
	})
}

func TestCommonRequestFilter(t *testing.T) {

	// Negative test cases

	r, err := http.NewRequest("GET", "http://localhost:8080/favicon.ico", nil)
	require.NoError(t, err)
	require.Falsef(t, CommonRequestFilter(r), "ignore favicon requests")

	r, err = http.NewRequest("OPTIONS", "http://localhost:8080", nil)
	require.NoError(t, err)
	require.Falsef(t, CommonRequestFilter(r), "ignore OPTIONS requests")

	r, err = http.NewRequest("GET", "http://localhost:8080", nil)
	r.Header.Set("Upgrade", "websocket")
	require.NoError(t, err)
	require.Falsef(t, CommonRequestFilter(r), "ignore websocket upgrades")

	r, err = http.NewRequest("PUT", "http://localhost:8080", nil)
	require.NoError(t, err)
	require.Falsef(t, CommonRequestFilter(r), "ignore PUT requests")

	r, err = http.NewRequest("DELETE", "http://localhost:8080", nil)
	require.NoError(t, err)
	require.Falsef(t, CommonRequestFilter(r), "ignore DELETE requests")

	// Positive test cases

	r, err = http.NewRequest("GET", "http://localhost:8080", nil)
	require.NoError(t, err)
	require.Truef(t, CommonRequestFilter(r), "allow GET requests")

	r, err = http.NewRequest("POST", "http://localhost:8080", nil)
	require.NoError(t, err)
	require.Truef(t, CommonRequestFilter(r), "allow POST requests")
}

func TestGetClientHeader(t *testing.T) {
	// no headers
	r, err := http.NewRequest("POST", "http://localhost:8080", nil)
	require.NoError(t, err)
	require.Equal(t, "unknown", GetClientHeader(r.Header, []string{"", "graphql-client-name", "apollographql-client-name"}, "unknown"))
	require.Equal(t, "missing", GetClientHeader(r.Header, []string{"", "graphql-client-version", "apollographql-client-version"}, "missing"))

	clientName := "name"
	clientVersion := "version"

	// pass values in default headers, but have configured the custom header names
	r, err = http.NewRequest("POST", "http://localhost:8080", nil)
	require.NoError(t, err)
	r.Header.Set("graphql-client-name", clientName)
	r.Header.Set("graphql-client-version", clientVersion)
	require.Equal(t, clientName, GetClientHeader(r.Header, []string{"client-name", "graphql-client-name", "apollographql-client-name"}, "unknown"))
	require.Equal(t, clientVersion, GetClientHeader(r.Header, []string{"client-version", "graphql-client-version", "apollographql-client-version"}, "missing"))

	// pass values in default headers, but have configured the custom header names
	r, err = http.NewRequest("POST", "http://localhost:8080", nil)
	require.NoError(t, err)
	r.Header.Set("apollographql-client-name", clientName)
	r.Header.Set("apollographql-client-version", clientVersion)
	require.Equal(t, clientName, GetClientHeader(r.Header, []string{"client-name", "graphql-client-name", "apollographql-client-name"}, "unknown"))
	require.Equal(t, clientVersion, GetClientHeader(r.Header, []string{"client-version", "graphql-client-version", "apollographql-client-version"}, "missing"))

	// pass values in custom headers, but the custom headers are not configured
	r, err = http.NewRequest("POST", "http://localhost:8080", nil)
	require.NoError(t, err)
	r.Header.Set("client-name", clientName)
	r.Header.Set("client-version", clientVersion)
	require.Equal(t, "unknown", GetClientHeader(r.Header, []string{"", "graphql-client-name", "apollographql-client-name"}, "unknown"))
	require.Equal(t, "missing", GetClientHeader(r.Header, []string{"", "graphql-client-version", "apollographql-client-version"}, "missing"))

	// pass values in custom headers
	r, err = http.NewRequest("POST", "http://localhost:8080", nil)
	require.NoError(t, err)
	r.Header.Set("client-name", clientName)
	r.Header.Set("client-version", clientVersion)
	require.Equal(t, clientName, GetClientHeader(r.Header, []string{"client-name", "graphql-client-name", "apollographql-client-name"}, "unknown"))
	require.Equal(t, clientVersion, GetClientHeader(r.Header, []string{"client-version", "graphql-client-version", "apollographql-client-version"}, "missing"))
}
