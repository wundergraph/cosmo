package requestlogger

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/middleware"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type Fn func(r *http.Request) []zapcore.Field

// Option provides a functional approach to define
// configuration for a handler; such as setting the logging
// whether to print stack traces on panic.
type Option func(handler *handler)

type handler struct {
	timeFormat string
	utc        bool
	skipPaths  []string
	traceID    bool // optionally log Open Telemetry TraceID
	context    Fn
	handler    http.Handler
	logger     *zap.Logger
}

func parseOptions(r *handler, opts ...Option) http.Handler {
	for _, option := range opts {
		option(r)
	}

	return r
}

func WithContext(fn Fn) Option {
	return func(r *handler) {
		r.context = fn
	}
}

func WithDefaultOptions() Option {
	return func(r *handler) {
		r.timeFormat = time.RFC3339
		r.utc = true
		r.skipPaths = []string{}
		r.traceID = true
		r.context = nil
	}
}

func New(logger *zap.Logger, opts ...Option) func(h http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		r := &handler{handler: h, logger: logger}
		return parseOptions(r, opts...)
	}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	// some evil middlewares modify this values
	path := r.URL.Path
	query := r.URL.RawQuery

	ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
	h.handler.ServeHTTP(ww, r)

	end := time.Now()
	latency := end.Sub(start)
	if h.utc {
		end = end.UTC()
	}

	fields := []zapcore.Field{
		zap.Int("status", ww.Status()),
		zap.String("method", r.Method),
		zap.String("path", path),
		zap.String("query", query),
		// Has to be set by a middleware before this one
		zap.String("ip", r.RemoteAddr),
		zap.String("user-agent", r.UserAgent()),
		zap.Duration("latency", latency),
	}
	if h.timeFormat != "" {
		fields = append(fields, zap.String("time", end.Format(h.timeFormat)))
	}
	if h.traceID {
		span := trace.SpanFromContext(r.Context())
		spanContext := span.SpanContext()
		if spanContext.HasTraceID() {
			fields = append(fields, zap.String("traceID", spanContext.TraceID().String()))
		}
		if spanContext.HasSpanID() {
			fields = append(fields, zap.String("spanID", spanContext.SpanID().String()))
		}
	}

	if h.context != nil {
		fields = append(fields, h.context(r)...)
	}

	h.logger.Info(path, fields...)

}
