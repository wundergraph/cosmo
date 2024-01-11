package core

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/middleware"
	"github.com/hashicorp/go-multierror"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/cosmo/router/internal/otel"
	"github.com/wundergraph/cosmo/router/internal/pool"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

var (
	errCouldNotResolveResponse = errors.New("could not resolve response")
	errServerTimeout           = errors.New("server timeout")
	errServerCanceled          = errors.New("server canceled")
	errInternalServer          = errors.New("internal server error")
)

type ReportError interface {
	error
	Report() *operationreport.Report
}

type reportError struct {
	report *operationreport.Report
}

func (e *reportError) Error() string {
	if len(e.report.InternalErrors) > 0 {
		return errors.Join(e.report.InternalErrors...).Error()
	}
	var messages []string
	for _, e := range e.report.ExternalErrors {
		messages = append(messages, e.Message)
	}
	return strings.Join(messages, ", ")
}

func (e *reportError) Report() *operationreport.Report {
	return e.report
}

type HandlerOptions struct {
	Executor                               *Executor
	Log                                    *zap.Logger
	EnableExecutionPlanCacheResponseHeader bool
	WebSocketStats                         WebSocketsStatistics
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		log:                                    opts.Log,
		executor:                               opts.Executor,
		enableExecutionPlanCacheResponseHeader: opts.EnableExecutionPlanCacheResponseHeader,
		websocketStats:                         opts.WebSocketStats,
	}
	return graphQLHandler
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

type GraphQLHandler struct {
	log                                    *zap.Logger
	executor                               *Executor
	enableExecutionPlanCacheResponseHeader bool
	websocketStats                         WebSocketsStatistics
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
	operationCtx := getOperationContext(r.Context())

	ctx := &resolve.Context{
		Variables: operationCtx.Variables(),
		Request: resolve.Request{
			Header: r.Header,
		},
		RenameTypeNames:       h.executor.RenameTypeNames,
		RequestTracingOptions: operationCtx.traceOptions,
		InitialPayload:        operationCtx.initialPayload,
		Extensions:            operationCtx.extensions,
	}
	ctx = ctx.WithContext(r.Context())
	defer propagateSubgraphErrors(ctx)

	switch p := operationCtx.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		w.Header().Set("Content-Type", "application/json")

		executionBuf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(executionBuf)

		err := h.executor.Resolver.ResolveGraphQLResponse(ctx, p.Response, nil, executionBuf)
		if err != nil {
			var nErr net.Error

			if errors.Is(err, context.Canceled) {
				writeRequestErrors(r, http.StatusRequestTimeout, graphql.RequestErrorsFromError(errServerCanceled), w, requestLogger)
			} else if errors.As(err, &nErr) && nErr.Timeout() {
				writeRequestErrors(r, http.StatusRequestTimeout, graphql.RequestErrorsFromError(errServerTimeout), w, requestLogger)
			} else {
				writeRequestErrors(r, http.StatusInternalServerError, graphql.RequestErrorsFromError(errCouldNotResolveResponse), w, requestLogger)
			}

			requestLogger.Error("unable to resolve GraphQL response", zap.Error(err))
			return
		}
		h.setExecutionPlanCacheResponseHeader(w, operationCtx.planCacheHit)
		_, err = executionBuf.WriteTo(w)
		if err != nil {
			requestLogger.Error("respond to client", zap.Error(err))
			return
		}
	case *plan.SubscriptionResponsePlan:
		var (
			writer resolve.SubscriptionResponseWriter
			ok     bool
		)
		h.setExecutionPlanCacheResponseHeader(w, operationCtx.planCacheHit)
		ctx, writer, ok = GetSubscriptionResponseWriter(ctx, ctx.Variables, r, w)
		if !ok {
			requestLogger.Error("connection not flushable")
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		h.websocketStats.SynchronousSubscriptionsInc()
		defer h.websocketStats.SynchronousSubscriptionsDec()
		err := h.executor.Resolver.ResolveGraphQLSubscription(ctx, p.Response, writer)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				requestLogger.Debug("context canceled: unable to resolve subscription response", zap.Error(err))
				writeRequestErrors(r, http.StatusInternalServerError, graphql.RequestErrorsFromError(errCouldNotResolveResponse), w, requestLogger)
				return
			}

			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
			writeRequestErrors(r, http.StatusInternalServerError, graphql.RequestErrorsFromError(errCouldNotResolveResponse), w, requestLogger)
			return
		}
	default:
		requestLogger.Error("unsupported plan kind")
		w.WriteHeader(http.StatusInternalServerError)
	}
}

const (
	ExecutionPlanCacheHeader = "X-WG-Execution-Plan-Cache"
)

func (h *GraphQLHandler) setExecutionPlanCacheResponseHeader(w http.ResponseWriter, planCacheHit bool) {
	if !h.enableExecutionPlanCacheResponseHeader {
		return
	}
	if planCacheHit {
		w.Header().Set(ExecutionPlanCacheHeader, "HIT")
	} else {
		w.Header().Set(ExecutionPlanCacheHeader, "MISS")
	}
}

func logInternalErrorsFromReport(report *operationreport.Report, requestLogger *zap.Logger) {
	var internalErr error
	for _, err := range report.InternalErrors {
		internalErr = multierror.Append(internalErr, err)
	}

	if internalErr != nil {
		requestLogger.Error("internal error", zap.Error(internalErr))
	}
}

func addErrorToTrace(ctx context.Context, err error) {
	if ctx == nil {
		return
	}
	if err == nil {
		return
	}
	span := trace.SpanFromContext(ctx)
	if span == nil {
		return
	}
	if err == nil {
		return
	}
	reqCtx := getRequestContext(ctx)
	if reqCtx == nil {
		return
	}
	if reqCtx.hasError {
		// already set status to codes.Error
		// and added error attribute,
		// so we can just record the error
		// we call this function multiple times,
		// e.g. if there are subgraph errors AND request errors,
		// so we might want to record all errors
		span.RecordError(err)
	} else {
		reqCtx.hasError = true
		description := err.Error()
		span.SetStatus(codes.Error, description)
		span.SetAttributes(otel.WgRequestError.Bool(true))
	}
}

func propagateSubgraphErrors(ctx *resolve.Context) {
	err := ctx.SubgraphErrors()
	addErrorToTrace(ctx.Context(), err)
}

func writeRequestErrors(r *http.Request, statusCode int, requestErrors graphql.RequestErrors, w http.ResponseWriter, requestLogger *zap.Logger) {
	if requestErrors != nil {
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
		if _, err := requestErrors.WriteResponse(w); err != nil {
			if requestLogger != nil {
				requestLogger.Error("error writing response", zap.Error(err))
			}
		}
	}
	addErrorToTrace(r.Context(), requestErrors)
}

func writeInternalError(r *http.Request, w http.ResponseWriter, requestLogger *zap.Logger) {
	writeRequestErrors(r, http.StatusInternalServerError, graphql.RequestErrorsFromError(errInternalServer), w, requestLogger)
}
