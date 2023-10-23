package core

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/middleware"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
)

type PreHandlerOptions struct {
	Logger   *zap.Logger
	Executor *Executor
	Metrics  *RouterMetrics
	Parser   *OperationParser
	Planner  *OperationPlanner
}

type PreHandler struct {
	log      *zap.Logger
	executor *Executor
	metrics  *RouterMetrics
	parser   *OperationParser
	planner  *OperationPlanner
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:      opts.Logger,
		executor: opts.Executor,
		metrics:  opts.Metrics,
		parser:   opts.Parser,
		planner:  opts.Planner,
	}
}

func (h *PreHandler) Handler(next http.Handler) http.Handler {

	fn := func(w http.ResponseWriter, r *http.Request) {
		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		var statusCode int
		var writtenBytes int64

		clientInfo := NewClientInfoFromRequest(r)
		metrics := h.metrics.StartOperation(r.Context(), clientInfo, r.ContentLength)
		defer metrics.Finish(r.Context(), &statusCode, &writtenBytes)

		operation, err := h.parser.ParseReader(r.Body)
		if err != nil {
			var reportErr ReportError
			var inputErr InputError
			switch {
			case errors.As(err, &inputErr):
				statusCode = inputErr.StatusCode()
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

		metrics.AddOperation(r.Context(), operation, OperationProtocolHTTP)

		opContext, err := h.planner.Plan(operation, clientInfo, requestLogger)
		if err != nil {
			var reportErr ReportError
			if errors.As(err, &reportErr) {
				w.WriteHeader(http.StatusBadRequest)
				writeRequestErrorsFromReport(reportErr.Report(), w, requestLogger)
			} else {
				requestLogger.Error("prepare plan failed", zap.Error(err))
				w.WriteHeader(http.StatusInternalServerError)
				writeRequestErrors(graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			}
			return
		}
		metrics.AddOperationContext(opContext)
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		newReq := r.WithContext(withOperationContext(r.Context(), opContext))

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, newReq)

		statusCode = ww.Status()
		writtenBytes = int64(ww.BytesWritten())
	}

	return http.HandlerFunc(fn)
}
