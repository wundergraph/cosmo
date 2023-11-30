package core

import (
	"crypto/ecdsa"
	"errors"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"net/http"
	"time"

	"github.com/go-chi/chi/middleware"
	"github.com/wundergraph/cosmo/router/internal/cdn"
	"github.com/wundergraph/cosmo/router/internal/logging"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/graphql"
	"go.uber.org/zap"
)

type PreHandlerOptions struct {
	Logger               *zap.Logger
	Executor             *Executor
	Metrics              *RouterMetrics
	Parser               *OperationParser
	Planner              *OperationPlanner
	AccessController     *AccessController
	DevelopmentMode      bool
	RouterPublicKey      *ecdsa.PublicKey
	EnableRequestTracing bool
}

type PreHandler struct {
	log                  *zap.Logger
	executor             *Executor
	metrics              *RouterMetrics
	parser               *OperationParser
	planner              *OperationPlanner
	accessController     *AccessController
	developmentMode      bool
	routerPublicKey      *ecdsa.PublicKey
	enableRequestTracing bool
}

func NewPreHandler(opts *PreHandlerOptions) *PreHandler {
	return &PreHandler{
		log:                  opts.Logger,
		executor:             opts.Executor,
		metrics:              opts.Metrics,
		parser:               opts.Parser,
		planner:              opts.Planner,
		accessController:     opts.AccessController,
		routerPublicKey:      opts.RouterPublicKey,
		developmentMode:      opts.DevelopmentMode,
		enableRequestTracing: opts.EnableRequestTracing,
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
		var (
			hasRequestError bool
			writtenBytes    int
			statusCode      = http.StatusOK
			traceOptions    = resolve.RequestTraceOptions{}
			tracePlanStart  int64
		)

		clientInfo := NewClientInfoFromRequest(r)
		metrics := h.metrics.StartOperation(clientInfo, requestLogger, r.ContentLength)
		defer func() {
			metrics.Finish(hasRequestError, statusCode, writtenBytes)
		}()

		body, err := h.parser.ReadBody(r.Context(), r.Body)
		if err != nil {
			hasRequestError = true
			requestLogger.Error(err.Error())
			writeRequestErrors(r, http.StatusBadRequest, graphql.RequestErrorsFromError(err), w, requestLogger)
			return
		}

		if h.enableRequestTracing {
			if clientInfo.WGRequestToken != "" && h.routerPublicKey != nil {
				_, err = jwt.Parse(clientInfo.WGRequestToken, func(token *jwt.Token) (interface{}, error) {
					return h.routerPublicKey, nil
				}, jwt.WithValidMethods([]string{jwt.SigningMethodES256.Name}))
				if err != nil {
					hasRequestError = true
					requestLogger.Error(fmt.Sprintf("failed to parse request token: %s", err.Error()))
					writeRequestErrors(r, http.StatusForbidden, graphql.RequestErrorsFromError(errors.New("invalid request token")), w, requestLogger)
					return
				}

				// Enable ART after successful CSRF check
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

		validatedReq, err := h.accessController.Access(w, r)
		if err != nil {
			hasRequestError = true
			requestLogger.Error(err.Error())
			writeRequestErrors(r, http.StatusUnauthorized, graphql.RequestErrorsFromError(err), w, requestLogger)
			return
		}
		r = validatedReq

		operation, err := h.parser.ParseReader(r.Context(), clientInfo, body, requestLogger)
		if err != nil {
			hasRequestError = true

			var reportErr ReportError
			var inputErr InputError
			var poNotFoundErr cdn.PersistentOperationNotFoundError
			switch {
			case errors.As(err, &inputErr):
				requestLogger.Error(inputErr.Error())
				writeRequestErrors(r, inputErr.StatusCode(), graphql.RequestErrorsFromError(err), w, requestLogger)
			case errors.As(err, &reportErr):
				report := reportErr.Report()
				logInternalErrorsFromReport(reportErr.Report(), requestLogger)
				writeRequestErrors(r, http.StatusOK, graphql.RequestErrorsFromOperationReport(*report), w, requestLogger)
			case errors.As(err, &poNotFoundErr):
				requestLogger.Debug("persisted operation not found",
					zap.String("sha256Hash", poNotFoundErr.Sha256Hash()),
					zap.String("clientName", poNotFoundErr.ClientName()))
				writeRequestErrors(r, http.StatusBadRequest, graphql.RequestErrorsFromError(errors.New(cdn.PersistedOperationNotFoundErrorCode)), w, requestLogger)

			default: // If we have an unknown error, we log it and return an internal server error
				requestLogger.Error(err.Error())
				writeRequestErrors(r, http.StatusInternalServerError, graphql.RequestErrorsFromError(errInternalServer), w, requestLogger)
			}
			return
		}

		commonAttributeValues := commonMetricAttributes(operation, OperationProtocolHTTP)

		metrics.AddAttributes(commonAttributeValues...)

		initializeSpan(r.Context(), operation, clientInfo, commonAttributeValues)

		// If the request has a query parameter wg_trace=true we skip the cache
		// and always plan the operation
		// this allows us to "write" to the plan
		if !traceOptions.ExcludePlannerStats {
			tracePlanStart = resolve.GetDurationNanoSinceTraceStart(r.Context())
		}
		opContext, err := h.planner.Plan(operation, clientInfo, traceOptions)
		if err != nil {
			hasRequestError = true
			requestLogger.Error("failed to plan operation", zap.Error(err))
			writeRequestErrors(r, http.StatusBadRequest, graphql.RequestErrorsFromError(errMsgOperationParseFailed), w, requestLogger)
			return
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
		hasRequestError = requestContext.hasError
	})
}
