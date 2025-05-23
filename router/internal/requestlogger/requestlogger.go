package requestlogger

import (
	"crypto/sha256"
	"fmt"
	"github.com/wundergraph/cosmo/router/internal/errors"
	"github.com/wundergraph/cosmo/router/internal/expr"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type ContextFunc func(
	logger *zap.Logger,
	fields []config.CustomAttribute,
	exprFields []ExpressionAttribute,
	err any,
	r *http.Request,
	rh *http.Header,
	overrideExprCtx *expr.Context,
) []zapcore.Field

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
	accessLogger *accessLogger
	handler      http.Handler
	logger       *zap.Logger
}

func parseOptions(r *handler, opts ...Option) http.Handler {
	for _, option := range opts {
		option(r)
	}

	return r
}

func WithAttributes(attributes []config.CustomAttribute) Option {
	return func(r *handler) {
		r.accessLogger.attributes = attributes
	}
}

func WithExprAttributes(attributes []ExpressionAttribute) Option {
	return func(r *handler) {
		r.accessLogger.exprAttributes = attributes
	}
}

func WithAnonymization(ipConfig *IPAnonymizationConfig) Option {
	return func(r *handler) {
		r.accessLogger.ipAnonymizationConfig = ipConfig
	}
}

func WithFieldsHandler(fn ContextFunc) Option {
	return func(r *handler) {
		r.accessLogger.fieldsHandler = fn
	}
}

func WithNoTimeField() Option {
	return func(r *handler) {
		r.accessLogger.timeFormat = ""
		r.accessLogger.utc = false
	}
}

func WithFields(fields ...zapcore.Field) Option {
	return func(r *handler) {
		r.accessLogger.baseFields = fields
	}
}

func WithDefaultOptions() Option {
	return func(r *handler) {
		r.accessLogger.timeFormat = time.RFC3339
		r.accessLogger.utc = true
		r.accessLogger.skipPaths = []string{}
		r.accessLogger.traceID = true
		r.accessLogger.fieldsHandler = nil
	}
}

func New(logger *zap.Logger, opts ...Option) func(h http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		r := &handler{
			handler:      h,
			logger:       logger.With(zap.String("log_type", "request")),
			accessLogger: &accessLogger{},
		}
		return parseOptions(r, opts...)
	}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {

	start := time.Now()
	path := r.URL.Path
	fields := h.accessLogger.getRequestFields(r)

	defer func() {

		if err := recover(); err != nil {

			latency := time.Since(start)

			// Check for a broken connection, as it is not really a
			// condition that warrants a panic stack trace.
			var brokenPipe bool
			if ne, ok := err.(*net.OpError); ok {
				brokenPipe = errors.IsBrokenPipe(ne.Err)
			}

			fields = append(fields,
				// Internal Server Error. Although the status code is not set, it will be in the recover middleware
				zap.Int("status", 500),
				zap.Duration("latency", latency),
				zap.Any("error", err),
			)

			// This is only called on panic so it is safe to call it here again
			// to gather all the fields that are needed for logging
			if h.accessLogger.fieldsHandler != nil {
				fields = append(fields, h.accessLogger.fieldsHandler(h.logger, h.accessLogger.attributes, h.accessLogger.exprAttributes, err, r, nil, nil)...)
			}

			if brokenPipe {
				fields = append(fields, zap.Bool("broken_pipe", brokenPipe))
				// Avoid logging the stack trace for broken pipe errors
				h.logger.WithOptions(zap.AddStacktrace(zapcore.PanicLevel)).Error(path, fields...)
			} else {
				h.logger.Error("[Recovery from panic]", fields...)
			}

			// Dpanic will panic already in development but in production it will log the error and continue
			// For those reasons we panic here to pass it to the recovery middleware in all cases
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

	if h.accessLogger.fieldsHandler != nil {
		resFields = append(resFields, h.accessLogger.fieldsHandler(h.logger, h.accessLogger.attributes, h.accessLogger.exprAttributes, nil, r, nil, nil)...)
	}

	h.logger.Info(path, append(fields, resFields...)...)
}

func (al *accessLogger) getRequestFields(r *http.Request) []zapcore.Field {
	if r == nil {
		return al.baseFields
	}

	start := time.Now()
	url := r.URL
	path := url.Path
	query := url.RawQuery
	remoteAddr := r.RemoteAddr

	if al.ipAnonymizationConfig != nil && al.ipAnonymizationConfig.Enabled {
		if al.ipAnonymizationConfig.Method == Hash {
			h := sha256.New()
			remoteAddr = fmt.Sprintf("%x", h.Sum([]byte(r.RemoteAddr)))
		} else if al.ipAnonymizationConfig.Method == Redact {
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

	if len(al.baseFields) > 0 {
		fields = append(fields, al.baseFields...)
	}

	if al.utc {
		start = start.UTC()
	}

	if al.timeFormat != "" {
		fields = append(fields, zap.String("time", start.Format(al.timeFormat)))
	}

	if al.traceID {
		traceID := rtrace.GetTraceID(r.Context())
		if traceID != "" {
			fields = append(fields, logging.WithTraceID(traceID))
		}
	}

	return fields
}
