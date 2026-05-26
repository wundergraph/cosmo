package trace

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
)

func TestTransport(t *testing.T) {

	t.Run("create a span for every request", func(t *testing.T) {
		content := []byte("Hello, world!")

		exporter := tracetest.NewInMemoryExporter(t)

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, err := w.Write(content); err != nil {
				t.Fatal(err)
			}
		}))
		defer ts.Close()

		tsURL := ts.URL + "/test"
		r, err := http.NewRequestWithContext(context.Background(), http.MethodGet, tsURL, nil)
		if err != nil {
			t.Fatal(err)
		}

		tp := sdktrace.NewTracerProvider(
			sdktrace.WithSyncer(exporter),
			sdktrace.WithSpanProcessor(&semconvProcessor{}),
		)

		tr := NewTransport(http.DefaultTransport, []otelhttp.Option{
			otelhttp.WithSpanOptions(trace.WithAttributes(otel.WgComponentName.String("test"))),
			otelhttp.WithTracerProvider(&FilteringTracerProvider{TracerProvider: tp}),
		})

		c := http.Client{Transport: tr}
		res, err := c.Do(r)
		if err != nil {
			t.Fatal(err)
		}

		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}

		if !bytes.Equal(body, content) {
			t.Fatalf("unexpected content: got %s, expected %s", body, content)
		}

		sn := exporter.GetSpans().Snapshots()
		assert.Len(t, sn, 1)
		assert.Equal(t, "HTTP GET", sn[0].Name())
		assert.Equal(t, trace.SpanKindClient, sn[0].SpanKind())
		assert.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())

		sa := attribute.NewSet(sn[0].Attributes()...)

		// Verify semconvProcessor remapped common attributes to old-style names
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPMethodKey.String("GET"))
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPURL(tsURL))
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPStatusCode(200))
		assert.Contains(t, sn[0].Attributes(), otel.WgComponentName.String("test"))

		// Verify semconvProcessor remapped client-specific attributes
		assert.True(t, sa.HasValue(semconv.NetPeerNameKey), "server.address should be remapped to net.peer.name")
		assert.True(t, sa.HasValue(semconv.NetPeerPortKey), "server.port should be remapped to net.peer.port")

		// Verify FilteringTracerProvider dropped new-semconv keys with no old equivalent
		for _, key := range []attribute.Key{"url.path", "client.address", "network.local.address", "network.local.port"} {
			assert.False(t, sa.HasValue(key), "dropped key %q should not be present", key)
		}
	})

	t.Run("set span status to error", func(t *testing.T) {
		content := []byte("Hello, world!")

		exporter := tracetest.NewInMemoryExporter(t)

		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
			if _, err := w.Write(content); err != nil {
				t.Fatal(err)
			}
		}))
		defer ts.Close()

		tsURL := ts.URL + "/test"
		r, err := http.NewRequestWithContext(context.Background(), http.MethodGet, tsURL, nil)
		if err != nil {
			t.Fatal(err)
		}

		tp := sdktrace.NewTracerProvider(
			sdktrace.WithSyncer(exporter),
			sdktrace.WithSpanProcessor(&semconvProcessor{}),
		)

		tr := NewTransport(http.DefaultTransport, []otelhttp.Option{
			otelhttp.WithSpanOptions(trace.WithAttributes(otel.WgComponentName.String("test"))),
			otelhttp.WithTracerProvider(&FilteringTracerProvider{TracerProvider: tp}),
		})

		c := http.Client{Transport: tr}
		res, err := c.Do(r)
		if err != nil {
			t.Fatal(err)
		}

		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}

		if !bytes.Equal(body, content) {
			t.Fatalf("unexpected content: got %s, expected %s", body, content)
		}

		sn := exporter.GetSpans().Snapshots()
		assert.Len(t, sn, 1)
		assert.Equal(t, "HTTP GET", sn[0].Name())
		assert.Equal(t, trace.SpanKindClient, sn[0].SpanKind())
		assert.Equal(t, sdktrace.Status{Code: codes.Error}, sn[0].Status())

		sa := attribute.NewSet(sn[0].Attributes()...)

		// Verify semconvProcessor remapped common attributes to old-style names
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPMethodKey.String("GET"))
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPFlavorKey.String("1.1"))
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPURL(tsURL))
		assert.Contains(t, sn[0].Attributes(), semconv.HTTPStatusCode(http.StatusInternalServerError))
		assert.Contains(t, sn[0].Attributes(), otel.WgComponentName.String("test"))

		// Verify error.type is present for 5xx responses
		assert.True(t, sa.HasValue("error.type"))

		// Verify semconvProcessor remapped client-specific attributes
		assert.True(t, sa.HasValue(semconv.NetPeerNameKey), "server.address should be remapped to net.peer.name")
		assert.True(t, sa.HasValue(semconv.NetPeerPortKey), "server.port should be remapped to net.peer.port")

		// Verify FilteringTracerProvider dropped new-semconv keys with no old equivalent
		for _, key := range []attribute.Key{"url.path", "client.address", "network.local.address", "network.local.port"} {
			assert.False(t, sa.HasValue(key), "dropped key %q should not be present", key)
		}
	})

	t.Run("context canceled does not set span status to error", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter(t)

		// Slow server that takes longer than the client will wait
		ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(2 * time.Second)
			w.WriteHeader(http.StatusOK)
		}))
		defer ts.Close()

		// Use WithCancel to simulate a client disconnect (produces context.Canceled)
		ctx, cancel := context.WithCancel(context.Background())

		r, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/test", nil)
		require.NoError(t, err)

		tr := NewTransport(http.DefaultTransport, []otelhttp.Option{
			otelhttp.WithSpanOptions(trace.WithAttributes(otel.WgComponentName.String("test"))),
			otelhttp.WithTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))),
		})

		// Cancel the context after a short delay to simulate client disconnect
		time.AfterFunc(50*time.Millisecond, cancel)

		c := http.Client{Transport: tr}
		_, err = c.Do(r)
		require.Error(t, err)

		sn := exporter.GetSpans().Snapshots()
		require.Len(t, sn, 1)

		span := sn[0]

		require.Equal(t, "HTTP GET", span.Name())

		// The span should NOT be marked as Error for client disconnections.
		// Our transport pre-sets Ok to prevent otelhttp from overriding with Error.
		require.NotEqual(t, codes.Error, span.Status().Code,
			"context.Canceled should not produce an Error span status")
		require.Equal(t, codes.Ok, span.Status().Code,
			"context.Canceled should produce an Ok span status (prevents otelhttp override)")
	})
}
