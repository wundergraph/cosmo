package core

import (
	"context"
	"crypto/ecdsa"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/wundergraph/cosmo/router/pkg/logging"
	"github.com/wundergraph/cosmo/router/pkg/otel"
	rtrace "github.com/wundergraph/cosmo/router/pkg/trace"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/go-chi/chi/middleware"
	"go.uber.org/zap"

	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/pool"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
)

type PreHandlerOptions struct {
	Logger                      *zap.Logger
	Executor                    *Executor
	Metrics                     RouterMetrics
	OperationProcessor          *OperationProcessor
	Planner                     *OperationPlanner
	AccessController            *AccessController
	DevelopmentMode             bool
	RouterPublicKey             *ecdsa.PublicKey
	EnableRequestTracing        bool
	TracerProvider              *sdktrace.TracerProvider
	FlushTelemetryAfterResponse bool
	TraceExportVariables        bool
}

type PreHandler struct {
	log                         *zap.Logger
	executor                    *Executor
	metrics                     RouterMetrics
	operationProcessor          *OperationProcessor
	planner                     *OperationPlanner
	accessController            *AccessController
	developmentMode             bool
	routerPublicKey             *ecdsa.PublicKey
	enableRequestTracing        bool
	tracerProvider              *sdktrace.TracerProvider
	flushTelemetryAfterResponse bool
	tracer                      trace.Tracer
	traceExportVariables        bool
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:                         opts.Logger,
		executor:                    opts.Executor,
		metrics:                     opts.Metrics,
		operationProcessor:          opts.OperationProcessor,
		planner:                     opts.Planner,
		accessController:            opts.AccessController,
		routerPublicKey:             opts.RouterPublicKey,
		developmentMode:             opts.DevelopmentMode,
		enableRequestTracing:        opts.EnableRequestTracing,
		flushTelemetryAfterResponse: opts.FlushTelemetryAfterResponse,
		tracerProvider:              opts.TracerProvider,
		traceExportVariables:        opts.TraceExportVariables,

		tracer: opts.TracerProvider.Tracer(
			"wundergraph/cosmo/router/pre_handler",
			trace.WithInstrumentationVersion("0.0.1"),
		),
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

		var (
			// In GraphQL the statusCode does not always express the error state of the request
			// we use this flag to determine if we have an error for the request metrics
			finalErr       error
			writtenBytes   int
			statusCode     = http.StatusOK
			traceOptions   = resolve.TraceOptions{}
			tracePlanStart int64
		)

		routerSpan := trace.SpanFromContext(r.Context())

		clientInfo := NewClientInfoFromRequest(r)
		baseAttributeValues := []attribute.KeyValue{
			otel.WgClientName.String(clientInfo.Name),
			otel.WgClientVersion.String(clientInfo.Version),
			otel.WgOperationProtocol.String(OperationProtocolHTTP.String()),
		}

		metrics := h.metrics.StartOperation(clientInfo, requestLogger, r.ContentLength)

		routerSpan.SetAttributes(baseAttributeValues...)
		metrics.AddAttributes(baseAttributeValues...)

		if h.flushTelemetryAfterResponse {
			defer h.flushMetrics(r.Context(), requestLogger)
		}

		defer func() {
			metrics.Finish(finalErr, statusCode, writtenBytes)
		}()

		// XXX: This buffer needs to be returned to the pool only
		// AFTER we're done with body (retrieved from parser.ReadBody())
		buf := pool.GetBytesBuffer()
		defer pool.PutBytesBuffer(buf)

		body, err := h.operationProcessor.ReadBody(buf, r.Body)
		if err != nil {
			finalErr = err
			requestLogger.Error(err.Error())
			writeRequestErrors(r.Context(), http.StatusBadRequest, graphql.RequestErrorsFromError(err), w, requestLogger)
			return
		}

		/**
		* Parse the operation
		 */

		engineParseCtx, engineParseSpan := h.tracer.Start(r.Context(), "Operation - Parse",
			trace.WithSpanKind(trace.SpanKindInternal),
		)

		operationKit, err := h.operationProcessor.NewKit(body)
		defer operationKit.Free()

		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineParseSpan, err)
			engineParseSpan.End()

			h.writeOperationError(engineParseCtx, w, requestLogger, err)
			return
		}

		err = operationKit.Parse(r.Context(), clientInfo, requestLogger)
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineParseSpan, err)
			engineParseSpan.End()

			h.writeOperationError(engineParseCtx, w, requestLogger, err)
			return
		}

		engineParseSpan.End()

		// Set the router span name after we have the operation name
		routerSpan.SetName(GetSpanName(operationKit.parsedOperation.Name, operationKit.parsedOperation.Type))

		baseAttributeValues = []attribute.KeyValue{
			otel.WgOperationName.String(operationKit.parsedOperation.Name),
			otel.WgOperationType.String(operationKit.parsedOperation.Type),
		}
		if operationKit.parsedOperation.PersistedID != "" {
			baseAttributeValues = append(baseAttributeValues, otel.WgOperationPersistedID.String(operationKit.parsedOperation.PersistedID))
		}

		routerSpan.SetAttributes(baseAttributeValues...)
		metrics.AddAttributes(baseAttributeValues...)

		/**
		* Normalize the operation
		 */

		engineNormalizeCtx, engineNormalizeSpan := h.tracer.Start(r.Context(), "Operation - Normalize",
			trace.WithSpanKind(trace.SpanKindInternal),
		)

		err = operationKit.Normalize()
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineNormalizeSpan, err)
			engineNormalizeSpan.End()

			h.writeOperationError(engineNormalizeCtx, w, requestLogger, err)
			return
		}

		engineNormalizeSpan.End()

		if h.traceExportVariables {
			// At this stage the variables are normalized
			routerSpan.SetAttributes(otel.WgOperationVariables.String(string(operationKit.parsedOperation.Variables)))
		}

		baseAttributeValues = []attribute.KeyValue{
			otel.WgOperationHash.String(strconv.FormatUint(operationKit.parsedOperation.ID, 10)),
		}

		// Set the normalized operation as soon as we have it
		routerSpan.SetAttributes(otel.WgOperationContent.String(operationKit.parsedOperation.NormalizedRepresentation))
		routerSpan.SetAttributes(baseAttributeValues...)

		metrics.AddAttributes(baseAttributeValues...)

		/**
		* Validate the operation
		 */

		engineValidateCtx, engineValidateSpan := h.tracer.Start(r.Context(), "Operation - Validate",
			trace.WithSpanKind(trace.SpanKindInternal),
		)
		err = operationKit.Validate()
		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(engineValidateSpan, err)
			engineValidateSpan.End()

			h.writeOperationError(engineValidateCtx, w, requestLogger, err)
			return
		}

		if h.enableRequestTracing {
			if clientInfo.WGRequestToken != "" && h.routerPublicKey != nil {
				_, err = jwt.Parse(clientInfo.WGRequestToken, func(token *jwt.Token) (interface{}, error) {
					return h.routerPublicKey, nil
				}, jwt.WithValidMethods([]string{jwt.SigningMethodES256.Name}))
				if err != nil {
					err := errors.New("invalid request token. Router version 0.42.1 or above is required to use request tracing in production")
					finalErr = err
					requestLogger.Error(fmt.Sprintf("failed to parse request token: %s", err.Error()))
					writeRequestErrors(r.Context(), http.StatusForbidden, graphql.RequestErrorsFromError(err), w, requestLogger)
					return
				}

				// Enable ART after successful request token validation
				traceOptions = ParseRequestTraceOptions(r)
			} else if h.developmentMode {
				// In development, without request signing, we enable ART
				traceOptions = ParseRequestTraceOptions(r)
			} else {
				// In production, without request signing, we disable ART because it's not safe to use
				traceOptions.DisableAll()
			}
		}

		if traceOptions.Enable {
			r = r.WithContext(resolve.SetTraceStart(r.Context(), traceOptions.EnablePredictableDebugTimings))
		}

		engineValidateSpan.End()

		/**
		* Plan the operation
		 */

		enginePlanSpanCtx, enginePlanSpan := h.tracer.Start(r.Context(), "Operation - Plan",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(otel.WgEngineRequestTracingEnabled.Bool(traceOptions.Enable)),
		)

		opContext, err := h.planner.Plan(operationKit.parsedOperation, clientInfo, OperationProtocolHTTP, traceOptions)

		if err != nil {
			finalErr = err

			rtrace.AttachErrToSpan(enginePlanSpan, err)
			enginePlanSpan.End()

			requestLogger.Error("failed to plan operation", zap.Error(err))
			h.writeOperationError(enginePlanSpanCtx, w, requestLogger, err)
			return
		}

		enginePlanSpan.SetAttributes(otel.WgEnginePlanCacheHit.Bool(opContext.planCacheHit))

		enginePlanSpan.End()

		// If we have authenticators, we try to authenticate the request
		if len(h.accessController.authenticators) > 0 {
			authenticateSpanCtx, authenticateSpan := h.tracer.Start(r.Context(), "Authenticate",
				trace.WithSpanKind(trace.SpanKindServer),
			)

			validatedReq, err := h.accessController.Access(w, r)
			if err != nil {
				finalErr = err
				requestLogger.Error(err.Error())

				rtrace.AttachErrToSpan(authenticateSpan, err)
				authenticateSpan.End()

				writeRequestErrors(authenticateSpanCtx, http.StatusUnauthorized, graphql.RequestErrorsFromError(err), w, requestLogger)
				return
			}

			authenticateSpan.End()

			r = validatedReq
		}

		// If the request has a query parameter wg_trace=true we skip the cache
		// and always plan the operation
		// this allows us to "write" to the plan
		if !traceOptions.ExcludePlannerStats {
			tracePlanStart = resolve.GetDurationNanoSinceTraceStart(r.Context())
		}

		if !traceOptions.ExcludePlannerStats {
			planningTime := resolve.GetDurationNanoSinceTraceStart(r.Context()) - tracePlanStart
			resolve.SetPlannerStats(r.Context(), resolve.PlannerStats{
				DurationSinceStartNano:   tracePlanStart,
				DurationSinceStartPretty: time.Duration(tracePlanStart).String(),
				PlanningTimeNano:         planningTime,
				PlanningTimePretty:       time.Duration(planningTime).String(),
			})
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
		finalErr = requestContext.error

		// Mark the root span of the router as failed, so we can easily identify failed requests
		routerSpan = trace.SpanFromContext(newReq.Context())
		if finalErr != nil {
			rtrace.AttachErrToSpan(routerSpan, finalErr)
		}
	})
}

func (h *PreHandler) flushMetrics(ctx context.Context, requestLogger *zap.Logger) {
	requestLogger.Debug("Flushing metrics ...")

	now := time.Now()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.metrics.GqlMetricsExporter().ForceFlush(ctx); err != nil {
			requestLogger.Error("Failed to flush schema usage metrics", zap.Error(err))
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.metrics.MetricStore().ForceFlush(ctx); err != nil {
			requestLogger.Error("Failed to flush OTEL metrics", zap.Error(err))
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := h.tracerProvider.ForceFlush(ctx); err != nil {
			requestLogger.Error("Failed to flush OTEL tracer", zap.Error(err))
		}
	}()

	wg.Wait()

	requestLogger.Debug("Metrics flushed", zap.Duration("duration", time.Since(now)))
}

func (h *PreHandler) writeOperationError(ctx context.Context, w http.ResponseWriter, requestLogger *zap.Logger, err error) {
	var reportErr ReportError
	var inputErr InputError
	var poNotFoundErr cdn.PersistentOperationNotFoundError
	switch {
	case errors.As(err, &inputErr):
		requestLogger.Debug(inputErr.Error())
		writeRequestErrors(ctx, inputErr.StatusCode(), graphql.RequestErrorsFromError(err), w, requestLogger)
	case errors.As(err, &poNotFoundErr):
		requestLogger.Debug("persisted operation not found",
			zap.String("sha256Hash", poNotFoundErr.Sha256Hash()),
			zap.String("clientName", poNotFoundErr.ClientName()))
		writeRequestErrors(ctx, http.StatusBadRequest, graphql.RequestErrorsFromError(errors.New(cdn.PersistedOperationNotFoundErrorCode)), w, requestLogger)
	case errors.As(err, &reportErr):
		report := reportErr.Report()
		logInternalErrorsFromReport(reportErr.Report(), requestLogger)

		requestErrors := graphql.RequestErrorsFromOperationReport(*report)
		if len(requestErrors) > 0 {
			writeRequestErrors(ctx, http.StatusOK, requestErrors, w, requestLogger)
			return
		} else {
			// there was no external errors to return to user,
			// so we return an internal server error
			writeInternalError(ctx, w, requestLogger)
		}
	default: // If we have an unknown error, we log it and return an internal server error
		requestLogger.Error(err.Error())
		writeInternalError(ctx, w, requestLogger)
	}
}
