package core

import (
	"errors"
	"github.com/go-chi/chi/middleware"
	"github.com/wundergraph/cosmo/router/internal/metric"
	"github.com/wundergraph/cosmo/router/internal/pool"
	"go.uber.org/zap"
	"io"
	"net/http"

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

//
// Error and Status Code handling
//
// When a server receives a well-formed GraphQL-over-HTTP request, it must return a
// well‐formed GraphQL response. The server's response describes the result of validating
// and executing the requested operation if successful, and describes any errors encountered
// during the request. This means working errors should be returned as part of the response body.
// Only in cases where the request is malformed or invalid GraphQL should the server return an HTTP 4xx or 5xx error code.
// That also implies parsing or validation errors. They should be returned as part of the response body.
// https://github.com/graphql/graphql-over-http/blob/main/spec/GraphQLOverHTTP.md#response

func (h *PreHandler) Handler(next http.Handler) http.Handler {

	fn := func(w http.ResponseWriter, r *http.Request) {

		// In GraphQL the statusCode does not always express the error state of the request
		// we use this flag to determine if we have an error for the request metrics
		var hasRequestError bool
		var statusCode int
		var writtenBytes int
		var metrics *OperationMetrics

		clientInfo := NewClientInfoFromRequest(r)

		if h.requestMetrics != nil {
			metrics = StartOperationMetrics(r.Context(), h.requestMetrics, r.ContentLength)

			defer func() {
				metrics.Finish(r.Context(), hasRequestError, statusCode, int64(writtenBytes))
			}()

			metrics.AddClientInfo(r.Context(), clientInfo)
		}

		requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))

		limitedReader := &io.LimitedReader{R: r.Body, N: h.maxRequestSizeInBytes}
		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)

		copiedBytes, err := io.Copy(buf, limitedReader)
		if err != nil {
			hasRequestError = true
			requestLogger.Error("failed to read request body", zap.Error(err))
			writeRequestErrors(r, graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			return
		}

		// If the request body is larger than the limit, limit reader will truncate the body
		// We check here if it was truncated and return an error
		if copiedBytes < r.ContentLength {
			hasRequestError = true
			err := errors.New("request body too large")
			requestLogger.Error("request body too large")
			writeRequestErrors(r, graphql.RequestErrorsFromError(err), w, requestLogger)
			return
		}

		operation, err := h.parser.Parse(buf.Bytes())
		if err != nil {
			hasRequestError = true

			var reportErr ReportError
			var inputErr InputError
			switch {
			case errors.As(err, &inputErr):
				statusCode = http.StatusUnprocessableEntity
				requestLogger.Error(inputErr.Error())
				writeRequestErrors(r, graphql.RequestErrorsFromError(err), w, requestLogger)
			case errors.As(err, &reportErr):
				report := reportErr.Report()
				logInternalErrorsFromReport(reportErr.Report(), requestLogger)
				writeRequestErrors(r, graphql.RequestErrorsFromOperationReport(*report), w, requestLogger)
			default: // If we have an unknown error, we log it and return an internal server error
				requestLogger.Error(err.Error())
				writeRequestErrors(r, graphql.RequestErrorsFromError(internalServerErrorErr), w, requestLogger)
			}
			return
		}

		// Set the operation attributes as early as possible, so they are available in the trace
		baseMetricAttributeValues := SetSpanOperationAttributes(r.Context(), operation)

		if h.requestMetrics != nil {
			metrics.AddSpanAttributes(baseMetricAttributeValues...)
		}

		variablesCopy := make([]byte, len(operation.Variables))
		copy(variablesCopy, operation.Variables)

		// OperationContext was added to the request as early as possible
		// to modify the context in the middleware chain

		opContext := &operationContext{
			name:       operation.Name,
			opType:     operation.Type,
			content:    operation.NormalizedRepresentation,
			hash:       operation.ID,
			variables:  variablesCopy,
			clientInfo: clientInfo,
		}

		subgraphs := subgraphsFromContext(r.Context())
		requestContext := &requestContext{
			logger:         requestLogger,
			keys:           map[string]any{},
			responseWriter: w,
			request:        r,
			operation:      opContext,
			subgraphs:      subgraphs,
		}

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
	}

	return http.HandlerFunc(fn)
}
