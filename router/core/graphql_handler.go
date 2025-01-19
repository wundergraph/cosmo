package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	rErrors "github.com/wundergraph/cosmo/router/internal/errors"
	rotel "github.com/wundergraph/cosmo/router/pkg/otel"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/graphql_datasource"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphqlerrors"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/statistics"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/operationreport"
)

var (
	errCouldNotResolveResponse  = errors.New("could not resolve response")
	errInternalServer           = errors.New("internal server error")
	errCouldNotFlushResponse    = errors.New("could not flush response")
	errOperationPlanUnsupported = errors.New("unsupported operation plan")
)

const (
	ExecutionPlanCacheHeader      = "X-WG-Execution-Plan-Cache"
	PersistedOperationCacheHeader = "X-WG-Persisted-Operation-Cache"
	NormalizationCacheHeader      = "X-WG-Normalization-Cache"
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
	messages := make([]string, len(e.report.ExternalErrors))
	for i, e := range e.report.ExternalErrors {
		messages[i] = e.Message
	}
	return strings.Join(messages, ", ")
}

func (e *reportError) Report() *operationreport.Report {
	return e.report
}

type HandlerOptions struct {
	Executor                                    *Executor
	Log                                         *zap.Logger
	EnableExecutionPlanCacheResponseHeader      bool
	EnablePersistedOperationCacheResponseHeader bool
	EnableNormalizationCacheResponseHeader      bool
	EnableResponseHeaderPropagation             bool
	EngineStats                                 statistics.EngineStatistics
	TracerProvider                              trace.TracerProvider
	Authorizer                                  *CosmoAuthorizer
	RateLimiter                                 *CosmoRateLimiter
	RateLimitConfig                             *config.RateLimitConfiguration
	SubgraphErrorPropagation                    config.SubgraphErrorPropagationConfiguration
	EngineLoaderHooks                           resolve.LoaderHooks
}

func NewGraphQLHandler(opts HandlerOptions) *GraphQLHandler {
	graphQLHandler := &GraphQLHandler{
		log:                                    opts.Log,
		executor:                               opts.Executor,
		enableExecutionPlanCacheResponseHeader: opts.EnableExecutionPlanCacheResponseHeader,
		enablePersistedOperationCacheResponseHeader: opts.EnablePersistedOperationCacheResponseHeader,
		enableNormalizationCacheResponseHeader:      opts.EnableNormalizationCacheResponseHeader,
		enableResponseHeaderPropagation:             opts.EnableResponseHeaderPropagation,
		engineStats:                                 opts.EngineStats,
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
	log         *zap.Logger
	executor    *Executor
	engineStats statistics.EngineStatistics
	tracer      trace.Tracer
	authorizer  *CosmoAuthorizer
	rateLimiter *CosmoRateLimiter

	rateLimitConfig          *config.RateLimitConfiguration
	subgraphErrorPropagation config.SubgraphErrorPropagationConfiguration
	engineLoaderHooks        resolve.LoaderHooks

	enableExecutionPlanCacheResponseHeader      bool
	enablePersistedOperationCacheResponseHeader bool
	enableNormalizationCacheResponseHeader      bool
	enableResponseHeaderPropagation             bool
}

func (h *GraphQLHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestContext := getRequestContext(r.Context())

	executionContext, graphqlExecutionSpan := h.tracer.Start(r.Context(), "Operation - Execute",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(requestContext.telemetry.traceAttrs...),
	)
	defer graphqlExecutionSpan.End()

	ctx := &resolve.Context{
		Variables:      requestContext.operation.variables,
		RemapVariables: requestContext.operation.remapVariables,
		Files:          requestContext.operation.files,
		Request: resolve.Request{
			Header: r.Header,
		},
		RenameTypeNames:  h.executor.RenameTypeNames,
		TracingOptions:   requestContext.operation.traceOptions,
		InitialPayload:   requestContext.operation.initialPayload,
		Extensions:       requestContext.operation.extensions,
		ExecutionOptions: requestContext.operation.executionOptions,
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

	switch p := requestContext.operation.preparedPlan.preparedPlan.(type) {
	case *plan.SynchronousResponsePlan:
		w.Header().Set("Content-Type", "application/json")
		h.setDebugCacheHeaders(w, requestContext.operation)

		if h.enableResponseHeaderPropagation {
			ctx = WithResponseHeaderPropagation(ctx)
		}

		defer propagateSubgraphErrors(ctx)

		resp, err := h.executor.Resolver.ResolveGraphQLResponse(ctx, p.Response, nil, HeaderPropagationWriter(w, ctx.Context()))
		requestContext.dataSourceNames = getSubgraphNames(p.Response.DataSources)

		if err != nil {
			trackFinalResponseError(ctx.Context(), err)
			h.WriteError(ctx, err, p.Response, w)
			return
		}

		graphqlExecutionSpan.SetAttributes(rotel.WgAcquireResolverWaitTimeMs.Int64(resp.ResolveAcquireWaitTime.Milliseconds()))
	case *plan.SubscriptionResponsePlan:
		var (
			writer resolve.SubscriptionResponseWriter
			ok     bool
		)
		h.setDebugCacheHeaders(w, requestContext.operation)

		defer propagateSubgraphErrors(ctx)
		ctx, writer, ok = GetSubscriptionResponseWriter(ctx, r, w)
		if !ok {
			requestContext.logger.Error("unable to get subscription response writer", zap.Error(errCouldNotFlushResponse))
			trackFinalResponseError(r.Context(), errCouldNotFlushResponse)
			writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errCouldNotFlushResponse), requestContext.logger)
			return
		}

		if !ctx.ExecutionOptions.SkipLoader {
			h.engineStats.ConnectionsInc()
			defer h.engineStats.ConnectionsDec()
		}

		err := h.executor.Resolver.ResolveGraphQLSubscription(ctx, p.Response, writer)
		requestContext.dataSourceNames = getSubgraphNames(p.Response.Response.DataSources)

		if err != nil {
			if errors.Is(err, context.Canceled) {
				requestContext.logger.Debug("context canceled: unable to resolve subscription response", zap.Error(err))
				trackFinalResponseError(r.Context(), err)
				return
			} else if errors.Is(err, ErrUnauthorized) {
				trackFinalResponseError(ctx.Context(), err)
				writeRequestErrors(r, w, http.StatusUnauthorized, graphqlerrors.RequestErrorsFromError(err), requestContext.logger)
				return
			}

			requestContext.logger.Error("unable to resolve subscription response", zap.Error(err))
			trackFinalResponseError(ctx.Context(), err)
			writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errCouldNotResolveResponse), requestContext.logger)
			return
		}
	default:
		requestContext.logger.Error("unsupported plan kind")
		trackFinalResponseError(ctx.Context(), errOperationPlanUnsupported)
		writeRequestErrors(r, w, http.StatusInternalServerError, graphqlerrors.RequestErrorsFromError(errOperationPlanUnsupported), requestContext.logger)
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
		IncludeStatsInResponseExtension: !h.rateLimitConfig.SimpleStrategy.HideStatsFromResponseExtension,
		Rate:                            h.rateLimitConfig.SimpleStrategy.Rate,
		Burst:                           h.rateLimitConfig.SimpleStrategy.Burst,
		Period:                          h.rateLimitConfig.SimpleStrategy.Period,
		RateLimitKey:                    h.rateLimitConfig.Storage.KeyPrefix,
		RejectExceedingRequests:         h.rateLimitConfig.SimpleStrategy.RejectExceedingRequests,
		ErrorExtensionCode: resolve.RateLimitErrorExtensionCode{
			Enabled: h.rateLimitConfig.ErrorExtensionCode.Enabled,
			Code:    h.rateLimitConfig.ErrorExtensionCode.Code,
		},
	}
	return WithRateLimiterStats(ctx)
}

// WriteError writes the error to the response writer. This function must be concurrency-safe.
// @TODO This function should be refactored to be a helper function for websocket and http error writing
// In the websocket case, we call this function concurrently as part of the polling loop. This is error-prone.
func (h *GraphQLHandler) WriteError(ctx *resolve.Context, err error, res *resolve.GraphQLResponse, w io.Writer) {
	reqContext := getRequestContext(ctx.Context())

	if reqContext == nil {
		h.log.Error("unable to get request context")
		return
	}

	requestLogger := reqContext.logger

	httpWriter, isHttpResponseWriter := w.(http.ResponseWriter)
	response := GraphQLErrorResponse{
		Errors: make([]graphqlError, 1),
		Data:   nil,
	}

	switch getErrorType(err) {
	case errorTypeMergeResult:
		var errMerge resolve.ErrMergeResult
		if !errors.As(err, &errMerge) {
			response.Errors[0].Message = "Internal server error"
			return
		}
		response.Errors[0].Message = errMerge.Error()
	case errorTypeRateLimit:
		response.Errors[0].Message = "Rate limit exceeded"
		if h.rateLimitConfig.ErrorExtensionCode.Enabled {
			response.Errors[0].Extensions = &Extensions{
				Code: h.rateLimitConfig.ErrorExtensionCode.Code,
			}
		}
		if !h.rateLimitConfig.SimpleStrategy.HideStatsFromResponseExtension {
			buf := bytes.NewBuffer(make([]byte, 0, 1024))
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
		}
		if isHttpResponseWriter {
			httpWriter.WriteHeader(h.rateLimiter.RejectStatusCode())
		}
	case errorTypeUnauthorized:
		response.Errors[0].Message = "Unauthorized"
		if h.authorizer.HasResponseExtensionData(ctx) {
			buf := bytes.NewBuffer(make([]byte, 0, 1024))
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
		var upgradeErr *graphql_datasource.UpgradeRequestError
		if h.subgraphErrorPropagation.PropagateStatusCodes && errors.As(err, &upgradeErr) && upgradeErr.StatusCode != 0 {
			response.Errors[0].Extensions = &Extensions{
				StatusCode: upgradeErr.StatusCode,
			}
			if subgraph := reqContext.subgraphResolver.BySubgraphURL(upgradeErr.URL); subgraph != nil {
				response.Errors[0].Message = fmt.Sprintf("Subscription Upgrade request failed for Subgraph '%s'.", subgraph.Name)
			} else {
				response.Errors[0].Message = "Subscription Upgrade request failed"
			}
		} else {
			response.Errors[0].Message = "Subscription Upgrade request failed"
		}
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusOK)
		}
	case errorTypeEDFS:
		response.Errors[0].Message = fmt.Sprintf("EDFS error: %s", err.Error())
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusInternalServerError)
		}
	case errorTypeInvalidWsSubprotocol:
		response.Errors[0].Message = fmt.Sprintf("Invalid Subprotocol error: %s or configure the subprotocol to be used using `wgc subgraph update` command.", err.Error())
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusInternalServerError)
		}
	case errorTypeEDFSInvalidMessage:
		response.Errors[0].Message = "Invalid message received"
		if isHttpResponseWriter {
			httpWriter.WriteHeader(http.StatusInternalServerError)
		}
	}

	if ctx.TracingOptions.Enable && ctx.TracingOptions.IncludeTraceOutputInResponseExtensions {
		traceNode := resolve.GetTrace(ctx.Context(), res.Fetches)
		if response.Extensions == nil {
			response.Extensions = &Extensions{}
		}
		response.Extensions.Trace, err = json.Marshal(traceNode)
		if err != nil {
			requestLogger.Error("Unable to marshal trace node", zap.Error(err))
		}
	}

	err = json.NewEncoder(w).Encode(response)
	if err != nil {
		if rErrors.IsBrokenPipe(err) {
			requestLogger.Warn("Broken pipe, unable to write error response", zap.Error(err))
		} else {
			requestLogger.Error("Unable to write error response", zap.Error(err))
		}
	}

	if wsRw, ok := w.(*websocketResponseWriter); ok {
		_ = wsRw.Flush()
	}
}

func (h *GraphQLHandler) setDebugCacheHeaders(w http.ResponseWriter, opCtx *operationContext) {
	if h.enableNormalizationCacheResponseHeader {
		if opCtx.normalizationCacheHit {
			w.Header().Set(NormalizationCacheHeader, "HIT")
		} else {
			w.Header().Set(NormalizationCacheHeader, "MISS")
		}
	}
	if h.enablePersistedOperationCacheResponseHeader {
		if opCtx.persistedOperationCacheHit {
			w.Header().Set(PersistedOperationCacheHeader, "HIT")
		} else {
			w.Header().Set(PersistedOperationCacheHeader, "MISS")
		}
	}
	if h.enableExecutionPlanCacheResponseHeader {
		if opCtx.planCacheHit {
			w.Header().Set(ExecutionPlanCacheHeader, "HIT")
		} else {
			w.Header().Set(ExecutionPlanCacheHeader, "MISS")
		}
	}
}
