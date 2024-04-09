package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/hashicorp/go-multierror"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/pool"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

var (
	errCouldNotResolveResponse = errors.New("could not resolve response")
	errInternalServer          = errors.New("internal server error")
)

type ErrUpgradeFailed struct {
	StatusCode int
	SubgraphID string
}

func (e *ErrUpgradeFailed) Error() string {
	return fmt.Sprintf("upgrade failed with status code %d", e.StatusCode)
}

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
	TracerProvider                         trace.TracerProvider
	Authorizer                             *CosmoAuthorizer
	RateLimiter                            *CosmoRateLimiter
	RateLimitConfig                        *config.RateLimitConfiguration
	SubgraphErrorPropagation               config.SubgraphErrorPropagationConfiguration
	EngineLoaderHooks                      resolve.LoaderHooks
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		log:                                    opts.Log,
		executor:                               opts.Executor,
		enableExecutionPlanCacheResponseHeader: opts.EnableExecutionPlanCacheResponseHeader,
		websocketStats:                         opts.WebSocketStats,
		tracer: opts.TracerProvider.Tracer(
			"wundergraph/cosmo/router/graphql_handler",
			trace.WithInstrumentationVersion("0.0.1"),
		),
		authorizer:               opts.Authorizer,
		rateLimiter:              opts.RateLimiter,
		rateLimitConfig:          opts.RateLimitConfig,
		subgraphErrorPropagation: opts.SubgraphErrorPropagation,
		engineLoaderHooks:        opts.EngineLoaderHooks,
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
	tracer                                 trace.Tracer
	authorizer                             *CosmoAuthorizer

	rateLimiter              *CosmoRateLimiter
	rateLimitConfig          *config.RateLimitConfiguration
	subgraphErrorPropagation config.SubgraphErrorPropagationConfiguration
	engineLoaderHooks        resolve.LoaderHooks
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
	operationCtx := getOperationContext(r.Context())

	executionContext, graphqlExecutionSpan := h.tracer.Start(r.Context(), "Operation - Execute",
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer graphqlExecutionSpan.End()

	ctx := &resolve.Context{
		Variables: operationCtx.Variables(),
		Request: resolve.Request{
			Header: r.Header,
		},
		RenameTypeNames: h.executor.RenameTypeNames,
		TracingOptions:  operationCtx.traceOptions,
		InitialPayload:  operationCtx.initialPayload,
		Extensions:      operationCtx.extensions,
	}
	ctx = ctx.WithContext(executionContext)
	if h.authorizer != nil {
		ctx = WithAuthorizationExtension(ctx)
		ctx.SetAuthorizer(h.authorizer)
	}
	if h.engineLoaderHooks != nil {
		ctx.SetEngineLoaderHooks(h.engineLoaderHooks)
	}
	ctx = h.configureRateLimiting(ctx)

	defer propagateSubgraphErrors(ctx)

	switch p := operationCtx.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		w.Header().Set("Content-Type", "application/json")
		executionBuf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(executionBuf)
		err := h.executor.Resolver.ResolveGraphQLResponse(ctx, p.Response, nil, executionBuf)
		if err != nil {
			h.WriteError(ctx, err, p.Response, w, executionBuf)
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
		h.websocketStats.ConnectionsInc()
		defer h.websocketStats.ConnectionsDec()
		err := h.executor.Resolver.ResolveGraphQLSubscription(ctx, p.Response, writer)
		if err != nil {
			if errors.Is(err, ErrUnauthorized) {
				writeRequestErrors(executionContext, r, w, http.StatusUnauthorized, graphql.RequestErrorsFromError(err), requestLogger)
			} else if errors.Is(err, context.Canceled) {
				requestLogger.Debug("context canceled: unable to resolve subscription response", zap.Error(err))
				writeRequestErrors(executionContext, r, w, http.StatusInternalServerError, graphql.RequestErrorsFromError(errCouldNotResolveResponse), requestLogger)
				return
			}

			requestLogger.Error("unable to resolve subscription response", zap.Error(err))
			writeRequestErrors(executionContext, r, w, http.StatusInternalServerError, graphql.RequestErrorsFromError(errCouldNotResolveResponse), requestLogger)
			return
		}
	default:
		requestLogger.Error("unsupported plan kind")
		w.WriteHeader(http.StatusInternalServerError)
	}
}

func (h *GraphQLHandler) configureRateLimiting(ctx *resolve.Context) *resolve.Context {
	if h.rateLimiter == nil {
		return ctx
	}
	if h.rateLimitConfig == nil {
		return ctx
	}
	if !h.rateLimitConfig.Enabled {
		return ctx
	}
	if h.rateLimitConfig.Strategy != "simple" {
		return ctx
	}
	ctx.SetRateLimiter(h.rateLimiter)
	ctx.RateLimitOptions = resolve.RateLimitOptions{
		Enable:                          true,
		IncludeStatsInResponseExtension: true,
		Rate:                            h.rateLimitConfig.SimpleStrategy.Rate,
		Burst:                           h.rateLimitConfig.SimpleStrategy.Burst,
		Period:                          h.rateLimitConfig.SimpleStrategy.Period,
		RateLimitKey:                    h.rateLimitConfig.Storage.KeyPrefix,
		RejectExceedingRequests:         h.rateLimitConfig.SimpleStrategy.RejectExceedingRequests,
	}
	return WithRateLimiterStats(ctx)
}

type GraphQLErrorResponse struct {
	Errors     []graphqlError `json:"errors"`
	Data       any            `json:"data"`
	Extensions *Extensions    `json:"extensions,omitempty"`
}

type Extensions struct {
	RateLimit     json.RawMessage `json:"rateLimit,omitempty"`
	Authorization json.RawMessage `json:"authorization,omitempty"`
	Trace         json.RawMessage `json:"trace,omitempty"`
	StatusCode    int             `json:"statusCode,omitempty"`
}

func (h *GraphQLHandler) WriteError(ctx *resolve.Context, err error, res *resolve.GraphQLResponse, w io.Writer, buf *bytes.Buffer) {
	requestLogger := h.log.With(logging.WithRequestID(middleware.GetReqID(ctx.Context())))
	httpWriter, isHttpResponseWriter := w.(http.ResponseWriter)
	addErrorToSpan(ctx.Context(), err)
	buf.Reset()
	response := GraphQLErrorResponse{
		Errors: make([]graphqlError, 1),
		Data:   nil,
	}
	switch h.errorType(err) {
	case errorTypeRateLimit:
		response.Errors[0].Message = "Rate limit exceeded"
		err = h.rateLimiter.RenderResponseExtension(ctx, buf)
		if err != nil {
			requestLogger.Error("unable to render rate limit stats", zap.Error(err))
			if isHttpResponseWriter {
				httpWriter.WriteHeader(http.StatusInternalServerError)
			}
			return
		}
		response.Extensions = &Extensions{
			RateLimit: buf.Bytes(),
		}
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusOK) // Always return 200 OK when we return a well-formed response
		}
	case errorTypeUnauthorized:
		response.Errors[0].Message = "Unauthorized"
		if h.authorizer.HasResponseExtensionData(ctx) {
			err = h.authorizer.RenderResponseExtension(ctx, buf)
			if err != nil {
				requestLogger.Error("unable to render authorization extension", zap.Error(err))
				if isHttpResponseWriter {
					httpWriter.WriteHeader(http.StatusInternalServerError)
				}
				return
			}
			response.Extensions = &Extensions{
				Authorization: buf.Bytes(),
			}
		}
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusOK) // Always return 200 OK when we return a well-formed response
		}
	case errorTypeContextCanceled:
		response.Errors[0].Message = "Client disconnected"
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusRequestTimeout)
		}
	case errorTypeContextTimeout:
		response.Errors[0].Message = "Server timeout"
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusRequestTimeout)
		}
	case errorTypeUnknown:
		response.Errors[0].Message = "Internal server error"
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusInternalServerError)
		}
	case errorTypeUpgradeFailed:
		response.Errors[0].Message = "Upgrade failed"
		var upgradeErr *ErrUpgradeFailed
		if h.subgraphErrorPropagation.StatusCodes && errors.As(err, &upgradeErr) && upgradeErr.StatusCode != 0 {
			response.Errors[0].Extensions = &Extensions{
				StatusCode: upgradeErr.StatusCode,
			}
			if upgradeErr.SubgraphID != "" {
				response.Errors[0].Message = fmt.Sprintf("Upgrade request failed for Subgraph '%s'.", upgradeErr.SubgraphID)
			}
		}
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusOK)
		}
	case errorTypeEDFSNats:
		response.Errors[0].Message = fmt.Sprintf("EDFS NATS error: %s", err.Error())
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusInternalServerError)
		}
	}
	if ctx.TracingOptions.Enable && ctx.TracingOptions.IncludeTraceOutputInResponseExtensions {
		traceNode := resolve.GetTrace(ctx.Context(), res.Data)
		if traceNode != nil {
			if response.Extensions == nil {
				response.Extensions = &Extensions{}
			}
			response.Extensions.Trace, err = json.Marshal(traceNode)
			if err != nil {
				requestLogger.Error("unable to marshal trace node", zap.Error(err))
			}
		}
	}
	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		requestLogger.Error("unable to write rate limit response", zap.Error(err))
	}
	if wsRw, ok := w.(*websocketResponseWriter); ok {
		_ = wsRw.Flush()
	}
}

type errorType int

const (
	errorTypeUnknown errorType = iota
	errorTypeRateLimit
	errorTypeUnauthorized
	errorTypeContextCanceled
	errorTypeContextTimeout
	errorTypeUpgradeFailed
	errorTypeEDFSNats
)

func (h *GraphQLHandler) errorType(err error) errorType {
	if errors.Is(err, ErrRateLimitExceeded) {
		return errorTypeRateLimit
	}
	if errors.Is(err, ErrUnauthorized) {
		return errorTypeUnauthorized
	}
	if errors.Is(err, context.Canceled) {
		return errorTypeContextCanceled
	}
	var upgradeErr *ErrUpgradeFailed
	if errors.As(err, &upgradeErr) {
		return errorTypeUpgradeFailed
	}
	var nErr net.Error
	if errors.As(err, &nErr) {
		if nErr.Timeout() {
			return errorTypeContextTimeout
		}
	}
	var edfsErr *pubsub.EDFSNatsError
	if errors.As(err, &edfsErr) {
		return errorTypeEDFSNats
	}
	return errorTypeUnknown
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

func addErrorToSpan(ctx context.Context, err error) {
	if err == nil {
		return
	}

	reqCtx := getRequestContext(ctx)
	if reqCtx == nil {
		return
	}

	reqCtx.error = err

	rtrace.AttachErrToSpan(trace.SpanFromContext(ctx), err)
}

func propagateSubgraphErrors(ctx *resolve.Context) {
	err := ctx.SubgraphErrors()
	addErrorToSpan(ctx.Context(), err)
}

func writeRequestErrors(ctx context.Context, r *http.Request, w http.ResponseWriter, statusCode int, requestErrors graphql.RequestErrors, requestLogger *zap.Logger) {
	addErrorToSpan(ctx, requestErrors)

	if requestErrors != nil {
		if statusCode != 0 {
			w.WriteHeader(statusCode)
		}
		if r.URL.Query().Has("wg_sse") {
			_, err := w.Write([]byte("event: next\ndata: "))
			if err != nil {
				if requestLogger != nil {
					requestLogger.Error("error writing response", zap.Error(err))
				}
				return
			}
		}
		if _, err := requestErrors.WriteResponse(w); err != nil {
			if requestLogger != nil {
				requestLogger.Error("error writing response", zap.Error(err))
			}
		}
	}
}

func writeInternalError(ctx context.Context, r *http.Request, w http.ResponseWriter, requestLogger *zap.Logger) {
	writeRequestErrors(ctx, r, w, http.StatusInternalServerError, graphql.RequestErrorsFromError(errInternalServer), requestLogger)
}
