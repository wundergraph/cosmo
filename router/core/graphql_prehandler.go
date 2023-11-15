package core

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/middleware"
	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"go.uber.org/zap"
)

type PreHandlerOptions struct {
	Logger           *zap.Logger
	Executor         *Executor
	Metrics          *RouterMetrics
	Parser           *OperationParser
	Planner          *OperationPlanner
	AccessController *AccessController
}

type PreHandler struct {
	log              *zap.Logger
	executor         *Executor
	metrics          *RouterMetrics
	parser           *OperationParser
	planner          *OperationPlanner
	accessController *AccessController
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:              opts.Logger,
		executor:         opts.Executor,
		metrics:          opts.Metrics,
		parser:           opts.Parser,
		planner:          opts.Planner,
		accessController: opts.AccessController,
	}
}

// Error and Status Code handling
//
// When a server receives a well-formed GraphQL-over-HTTP request, it must return a
// well‐formed GraphQL response. The server's response describes the result of validating
// and executing the requested operation if successful, and describes any errors encountered
// during the request. This means working errors should be returned as part of the response body.
// That also implies parsing or validation errors. They should be returned as part of the response body.
// Only in cases where the request is malformed or invalid GraphQL should the server return an HTTP 4xx or 5xx error code.
// https://github.com/graphql/graphql-over-http/blob/main/spec/GraphQLOverHTTP.md#response

func (h *PreHandler) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		// In GraphQL the statusCode does not always express the error state of the request
		// we use this flag to determine if we have an error for the request metrics
		var hasRequestError bool
		statusCode := http.StatusOK
		var writtenBytes int

		clientInfo := NewClientInfoFromRequest(r)
		metrics := h.metrics.StartOperation(clientInfo, requestLogger, r.ContentLength)

		defer func() {
			metrics.Finish(hasRequestError, statusCode, writtenBytes)
		}()

		validatedReq, err := h.accessController.Access(w, r)
		if err != nil {
			hasRequestError = true
			requestLogger.Error(err.Error())
			writeRequestErrors(r, graphql.RequestErrorsFromError(err), w, requestLogger)
			return
		}
		r = validatedReq

		operation, err := h.parser.ParseReader(r.Body)
		if err != nil {
			hasRequestError = true

			var reportErr ReportError
			var inputErr InputError
			switch {
			case errors.As(err, &inputErr):
				requestLogger.Error(inputErr.Error())
				writeRequestErrors(r, graphql.RequestErrorsFromError(err), w, requestLogger)
			case errors.As(err, &reportErr):
				report := reportErr.Report()
				logInternalErrorsFromReport(reportErr.Report(), requestLogger)
				writeRequestErrors(r, graphql.RequestErrorsFromOperationReport(*report), w, requestLogger)
			default: // If we have an unknown error, we log it and return an internal server error
				requestLogger.Error(err.Error())
				writeRequestErrors(r, graphql.RequestErrorsFromError(errInternalServer), w, requestLogger)
			}
			return
		}

		commonAttributeValues := commonMetricAttributes(operation, OperationProtocolHTTP)

		metrics.AddAttributes(commonAttributeValues...)

		initializeSpan(r.Context(), operation, clientInfo, commonAttributeValues)

		// If the request has a query parameter wg_trace=true we skip the cache
		// and always plan the operation
		// this allows us to "write" to the plan
		opContext, err := h.planner.Plan(r, operation, clientInfo)
		if err != nil {
			hasRequestError = true
			requestLogger.Error("failed to plan operation", zap.Error(err))
			writeRequestErrors(r, graphql.RequestErrorsFromError(errMsgOperationParseFailed), w, requestLogger)
			return
		}

		requestContext := buildRequestContext(w, r, opContext, requestLogger)
		metrics.AddOperationContext(opContext)

		ctxWithRequest := withRequestContext(r.Context(), requestContext)
		ctxWithOperation := withOperationContext(ctxWithRequest, opContext)
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		newReq := r.WithContext(ctxWithOperation)

		// Call the final handler that resolves the operation
		// and enrich the context to make it available in the request context as well for metrics etc.
		next.ServeHTTP(ww, newReq)

		statusCode = ww.Status()
		writtenBytes = ww.BytesWritten()

		// Evaluate the request after the request has been handled by the engine
		hasRequestError = requestContext.hasError
	})
}
