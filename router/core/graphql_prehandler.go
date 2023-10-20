package core

import (
	"errors"
	"io"
	"net/http"

	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/pool"

	"github.com/go-chi/chi/middleware"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
)

type PreHandlerOptions struct {
	Logger                *zap.Logger
	Parser                *OperationParser
	RequestMetrics        *metric.Metrics
	MaxRequestSizeInBytes int64
}

type PreHandler struct {
	log                   *zap.Logger
	requestMetrics        *metric.Metrics
	parser                *OperationParser
	Logger                *zap.Logger
	Executor              *Executor
	maxRequestSizeInBytes int64
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:                   opts.Logger,
		requestMetrics:        opts.RequestMetrics,
		parser:                opts.Parser,
		maxRequestSizeInBytes: opts.MaxRequestSizeInBytes,
	}
}

func (h *PreHandler) Handler(next http.Handler) http.Handler {

	fn := func(w http.ResponseWriter, r *http.Request) {

		var statusCode int
		var writtenBytes int
		var metrics *OperationMetrics

		clientInfo := NewClientInfoFromRequest(r)

		if h.requestMetrics != nil {
			metrics = StartOperationMetrics(r.Context(), h.requestMetrics, r.ContentLength)

			defer func() {
				metrics.Finish(r.Context(), statusCode, int64(writtenBytes))
			}()

			metrics.AddClientInfo(r.Context(), clientInfo)
		}

		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		limitedReader := &io.LimitedReader{R: r.Body, N: h.maxRequestSizeInBytes}
		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)

		copiedBytes, err := io.Copy(buf, limitedReader)
		if err != nil {
			statusCode = http.StatusInternalServerError
			requestLogger.Error("failed to read request body", zap.Error(err))
			w.WriteHeader(statusCode)
			writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		// If the request body is larger than the limit, limit reader will truncate the body
		// We check here if it was truncated and return an error
		if copiedBytes < r.ContentLength {
			statusCode = http.StatusRequestEntityTooLarge
			requestLogger.Error("request body too large")
			w.WriteHeader(statusCode)
			writeRequestErrors(graphql.RequestErrorsFromError(errors.New("request body too large")), w, requestLogger)
			return
		}

		operation, err := h.parser.Parse(buf.Bytes())
		if err != nil {
			var reportErr ReportError
			var inputErr InputError
			switch {
			case errors.As(err, &inputErr):
				statusCode = http.StatusBadRequest
				requestLogger.Error(inputErr.Error())
				w.WriteHeader(statusCode)
				w.Write([]byte(inputErr.Error()))
			case errors.As(err, &reportErr):
				report := reportErr.Report()
				// according to the graphql-over-http spec, internal errors should
				// use a 500 as status code, while external errors should use 200.
				// If we have both, we use 500.
				if len(report.InternalErrors) == 0 {
					statusCode = http.StatusOK
				} else {
					statusCode = http.StatusInternalServerError
				}
				logInternalErrors(report, requestLogger)
				w.WriteHeader(statusCode)
				writeRequestErrorsFromReport(report, w, requestLogger)
			default:
				statusCode = http.StatusInternalServerError
				requestLogger.Error(err.Error())
				w.WriteHeader(statusCode)
				writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			}
			return
		}

		if metrics != nil {
			metrics.AddOperation(r.Context(), operation, OperationProtocolHTTP)
		}

		ctxWithOperation := withOperationContext(r.Context(), operation, clientInfo)
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		newReq := r.WithContext(ctxWithOperation)

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, newReq)

		statusCode = ww.Status()
		writtenBytes = ww.BytesWritten()
	}

	return http.HandlerFunc(fn)
}
