package requestlogger

import (
	"crypto/sha256"
	"fmt"
	"go.opentelemetry.io/otel/trace"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"

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
	fields                []zapcore.Field
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

func WithRequestFields(fn Fn) Option {
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

func WithFields(fields ...zapcore.Field) Option {
	return func(r *handler) {
		r.fields = fields
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
	path := r.URL.Path
	query := r.URL.RawQuery
	remoteAddr := r.RemoteAddr

	if h.ipAnonymizationConfig != nil && h.ipAnonymizationConfig.Enabled {
		if h.ipAnonymizationConfig.Method == Hash {
			h := sha256.New()
			remoteAddr = fmt.Sprintf("%d", h.Sum([]byte(r.RemoteAddr)))
		} else if h.ipAnonymizationConfig.Method == Redact {
			remoteAddr = "[REDACTED]"
		}
	}

	// All fields are snake_case

	fields := []zapcore.Field{
		zap.String("method", r.Method),
		zap.String("path", path),
		zap.String("query", query),
		// Has to be processed by a middleware before this one
		zap.String("ip", remoteAddr),
		zap.String("user_agent", r.UserAgent()),
	}

	if len(h.fields) > 0 {
		fields = append(fields, h.fields...)
	}

	if h.context != nil {
		fields = append(fields, h.context(r)...)
	}

	if h.utc {
		start = start.UTC()
	}

	if h.timeFormat != "" {
		fields = append(fields, zap.String("time", start.Format(h.timeFormat)))
	}

	if h.traceID {
		span := trace.SpanFromContext(r.Context())
		spanContext := span.SpanContext()
		if spanContext.HasTraceID() {
			fields = append(fields, zap.String("trace_id", spanContext.TraceID().String()))
		}
	}

	defer func() {

		if err := recover(); err != nil {

			latency := time.Now().Sub(start)

			// Check for a broken connection, as it is not really a
			// condition that warrants a panic stack trace.
			var brokenPipe bool
			if ne, ok := err.(*net.OpError); ok {
				if se, ok := ne.Err.(*os.SyscallError); ok {
					if strings.Contains(strings.ToLower(se.Error()), "broken pipe") || strings.Contains(strings.ToLower(se.Error()), "connection reset by peer") {
						brokenPipe = true
					}
				}
			}

			fields = append(fields,
				// Internal Server Error. Although the status code is not set, it will be in the recover middleware
				zap.Int("status", 500),
				zap.Duration("latency", latency),
				zap.Any("error", err),
			)

			if brokenPipe {
				fields = append(fields, zap.Bool("broken_pipe", brokenPipe))
				h.logger.WithOptions(zap.AddStacktrace(zapcore.DPanicLevel)).Error(path, fields...)
			} else {
				h.logger.WithOptions(zap.AddStacktrace(zapcore.DPanicLevel)).Error("[Recovery from panic]", fields...)
			}

			// rethrow the error to the recover middleware can handle it
			panic(err)
		}

	}()

	ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
	h.handler.ServeHTTP(ww, r)
	end := time.Now()
	latency := end.Sub(start)

	resFields := []zapcore.Field{
		zap.Duration("latency", latency),
		zap.Int("status", ww.Status()),
	}

	h.logger.Info(path, append(fields, resFields...)...)
}
