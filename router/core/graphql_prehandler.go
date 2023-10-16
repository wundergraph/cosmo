package core

import (
	"errors"
	"net/http"

	"github.com/wundergraph/cosmo/router/internal/metric"

	"github.com/go-chi/chi/middleware"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
)

type PreHandlerOptions struct {
	Logger         *zap.Logger
	Parser         *OperationParser
	requestMetrics *metric.Metrics
}

type PreHandler struct {
	log            *zap.Logger
	requestMetrics *metric.Metrics
	parser         *OperationParser
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:            opts.Logger,
		requestMetrics: opts.requestMetrics,
		parser:         opts.Parser,
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

		operation, err := h.parser.ParseReader(r.Body)
		if err != nil {
			var reportErr ReportError
			var inputErr *inputError
			switch {
			case errors.As(err, &inputErr):
				statusCode = http.StatusBadRequest
				requestLogger.Error(inputErr.Error())
				w.WriteHeader(statusCode)
				w.Write([]byte(inputErr.Error()))
			case errors.As(err, &reportErr):
				report := reportErr.Report()
				statusCode = http.StatusBadRequest
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
