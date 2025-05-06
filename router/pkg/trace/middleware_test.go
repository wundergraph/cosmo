package trace

import (
	"github.com/go-chi/chi/v5"
	"github.com/wundergraph/cosmo/router/pkg/trace/tracetest"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv12 "go.opentelemetry.io/otel/semconv/v1.12.0"
	semconv17 "go.opentelemetry.io/otel/semconv/v1.17.0"
	"go.opentelemetry.io/otel/trace"
)

func TestWrapHttpHandler(t *testing.T) {

	t.Run("create a span for every request", func(t *testing.T) {
		exporter := tracetest.NewInMemoryExporter(t)
		h := NewMiddleware(
			WithOtelHttp(
				otelhttp.WithTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))),
			),
		)

		router := chi.NewRouter()

		router.Use(h.Handler)
		router.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})

		req := httptest.NewRequest("GET", "/test?a=b", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		sn := exporter.GetSpans().Snapshots()
		assert.Len(t, sn, 1)
		assert.Equal(t, "", sn[0].Name())
		assert.Equal(t, trace.SpanKindServer, sn[0].SpanKind())
		assert.Equal(t, sdktrace.Status{Code: codes.Unset}, sn[0].Status())
		assert.Len(t, sn[0].Attributes(), 9)

		assert.Contains(t, sn[0].Attributes(), semconv17.HTTPMethodKey.String("GET"))
		assert.Contains(t, sn[0].Attributes(), semconv17.HTTPScheme("http"))
		assert.Contains(t, sn[0].Attributes(), semconv17.HTTPFlavorKey.String("1.1"))
		assert.Contains(t, sn[0].Attributes(), semconv17.HTTPTarget("/test?a=b"))
		assert.Contains(t, sn[0].Attributes(), semconv17.HTTPStatusCode(200))
		assert.Contains(t, sn[0].Attributes(), semconv12.HTTPHostKey.String("example.com"))
	})

	t.Run("set span status to error", func(t *testing.T) {
		var statusCodeTests = []struct {
			statusCode int             // input
			expected   sdktrace.Status // expected result
		}{
			{200, sdktrace.Status{Code: codes.Unset, Description: ""}},
			{201, sdktrace.Status{Code: codes.Unset, Description: ""}},
			{300, sdktrace.Status{Code: codes.Unset, Description: ""}},
			{301, sdktrace.Status{Code: codes.Unset, Description: ""}},
			{400, sdktrace.Status{Code: codes.Unset, Description: ""}},
			{404, sdktrace.Status{Code: codes.Unset, Description: ""}},
			{500, sdktrace.Status{Code: codes.Error, Description: ""}},
		}

		exporter := tracetest.NewInMemoryExporter(t)

		for _, test := range statusCodeTests {
			router := chi.NewRouter()
			h := NewMiddleware(
				WithOtelHttp(
					otelhttp.WithTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))),
				),
			)

			statusCode := test.statusCode

			router.Use(h.Handler)
			router.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(statusCode)
			})

			req := httptest.NewRequest("GET", "/test?a=b", nil)
			w := httptest.NewRecorder()

			router.ServeHTTP(w, req)

			assert.Equal(t, statusCode, w.Code)

			sn := exporter.GetSpans().Snapshots()

			assert.Len(t, sn, 1)
			assert.Equal(t, "", sn[0].Name())
			assert.Equal(t, test.expected, sn[0].Status())
			assert.Equal(t, trace.SpanKindServer, sn[0].SpanKind())

			assert.Contains(t, sn[0].Attributes(), semconv17.HTTPMethodKey.String("GET"))
			assert.Contains(t, sn[0].Attributes(), semconv17.HTTPScheme("http"))
			assert.Contains(t, sn[0].Attributes(), semconv17.HTTPFlavorKey.String("1.1"))
			assert.Contains(t, sn[0].Attributes(), semconv17.HTTPTarget("/test?a=b"))
			assert.Contains(t, sn[0].Attributes(), semconv17.HTTPStatusCode(statusCode))

			exporter.Reset()
		}
	})
}
