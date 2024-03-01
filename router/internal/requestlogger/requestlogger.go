package requestlogger

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type Fn func(r *http.Request) []zapcore.Field

// Option provides a functional approach to define
// configuration for a handler; such as setting the logging
// whether to print stack traces on panic.
type (
	Option func(handler *handler)

	IPAnonymizationConfig struct {
		Enabled bool
		Method  IPAnonymizationMethod
	}
)

type IPAnonymizationMethod string

const (
	Hash   IPAnonymizationMethod = "hash"
	Redact IPAnonymizationMethod = "redact"
)

type handler struct {
	timeFormat            string
	utc                   bool
	skipPaths             []string
	ipAnonymizationConfig *IPAnonymizationConfig
	traceID               bool // optionally log Open Telemetry TraceID
	context               Fn
	handler               http.Handler
	logger                *zap.Logger
}

func parseOptions(r *handler, opts ...Option) http.Handler {
	for _, option := range opts {
		option(r)
	}

	return r
}

func WithAnonymization(ipConfig *IPAnonymizationConfig) Option {
	return func(r *handler) {
		r.ipAnonymizationConfig = ipConfig
	}
}

func WithContext(fn Fn) Option {
	return func(r *handler) {
		r.context = fn
	}
}

func WithNoTimeField() Option {
	return func(r *handler) {
		r.timeFormat = ""
		r.utc = false
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

	remoteAddr := r.RemoteAddr

	if h.ipAnonymizationConfig != nil && h.ipAnonymizationConfig.Enabled {
		if h.ipAnonymizationConfig.Method == Hash {
			h := sha256.New()
			remoteAddr = fmt.Sprintf("%d", h.Sum([]byte(r.RemoteAddr)))
		} else if h.ipAnonymizationConfig.Method == Redact {
			remoteAddr = "[REDACTED]"
		}
	}

	fields := []zapcore.Field{
		zap.Int("status", ww.Status()),
		zap.String("method", r.Method),
		zap.String("path", path),
		zap.String("query", query),
		// Has to be set by a middleware before this one
		zap.String("ip", remoteAddr),
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
	}

	if h.context != nil {
		fields = append(fields, h.context(r)...)
	}

	h.logger.Info(path, fields...)

}
