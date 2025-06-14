package core

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"bytes"
	"io"

	"go.uber.org/zap"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/wundergraph/cosmo/router/internal/utils"
	"github.com/wundergraph/cosmo/router/pkg/logging"
)

// Application Lifecycle Hooks
type ApplicationLifecycleHook interface {
	ApplicationStartHook
	ApplicationStopHook
}

type ApplicationStartHook interface {
	OnApplicationStart(ctx context.Context, params *ApplicationParams) error
}

type ApplicationStopHook interface {
	OnApplicationStop(ctx context.Context, params *ApplicationParams, exitError *ExitError) error
}

// GraphQL Server Lifecycle Hooks
type GraphQLServerLifecycleHook interface {
	GraphQLServerStartHook
	GraphQLServerStopHook
}

type GraphQLServerStartHook interface {
	OnGraphQLServerStart(ctx context.Context, params *GraphQLServerParams) error
}

type GraphQLServerStopHook interface {
	OnGraphQLServerStop(ctx context.Context, params *GraphQLServerParams, exitError *ExitError) error
}

// Router Lifecycle Hooks
type RouterRequestHook interface {	
	OnRouterRequest(reqContext RequestContext, params *RouterRequestParams) error
}

type RouterResponseHook interface {
	OnRouterResponse(reqContext RequestContext, params *RouterResponseParams, exitError *ExitError) error
}

type RouterLifecycleHook interface {
	RouterRequestHook
	RouterResponseHook
}

// Subgraph Lifecycle Hooks
type SubgraphRequestHook interface {
	OnSubgraphRequest(ctx context.Context)
}

type SubgraphResponseHook interface {
	OnSubgraphResponse(ctx context.Context)
}

type SubgraphLifecycleHook interface {
	SubgraphRequestHook
	SubgraphResponseHook
}

// Operation Lifecycle Hooks
type OperationLifecycleHook interface {
	OperationParseLifecycleHook
	OperationNormalizeLifecycleHook
	OperationValidateLifecycleHook
	OperationPlanLifecycleHook
	OperationExecuteLifecycleHook
}

// Operation Request Lifecycle Hooks
type OperationRequestLifecycleHook interface {
	OperationRequestHook
	OperationResponseHook
}

type OperationRequestHook interface {
	OnOperationRequest(reqContext RequestContext, params *OperationRequestParams) error
}

type OperationResponseHook interface {
	OnOperationResponse(reqContext RequestContext, params *OperationResponseParams, exitError *ExitError) error
}

type OperationParseLifecycleHook interface {
	OperationPreParseHook
	OperationPostParseHook
}

type OperationPreParseHook interface {
	OnOperationPreParse(reqContext RequestContext, params *OperationPreParseParams) error
}

type OperationPostParseHook interface {
	OnOperationPostParse(reqContext RequestContext, params *OperationPostParseParams, exitError *ExitError) error
}

type OperationNormalizeLifecycleHook interface {
	OperationPreNormalizeHook
	OperationPostNormalizeHook
}

type OperationPreNormalizeHook interface {
	OnOperationPreNormalize(reqContext RequestContext, params *OperationPreNormalizeParams) error
}

type OperationPostNormalizeHook interface {
	OnOperationPostNormalize(reqContext RequestContext, params *OperationPostNormalizeParams, exitError *ExitError) error
}

type OperationValidateLifecycleHook interface {
	OperationPreValidateHook
	OperationPostValidateHook
}

type OperationPreValidateHook interface {
	OnOperationPreValidate(reqContext RequestContext, params *OperationPreValidateParams) error	
}

type OperationPostValidateHook interface {
	OnOperationPostValidate(reqContext RequestContext, params *OperationPostValidateParams, exitError *ExitError) error
}

type OperationPlanLifecycleHook interface {
	OperationPrePlanHook
	OperationPostPlanHook
}

type OperationPrePlanHook interface {
	OnOperationPrePlan(reqContext RequestContext, params *OperationPrePlanParams) error
}

type OperationPostPlanHook interface {
	OnOperationPostPlan(reqContext RequestContext, params *OperationPostPlanParams, exitError *ExitError) error
}

type OperationExecuteLifecycleHook interface {
	OperationPreExecuteHook
	OperationPostExecuteHook
}

type OperationPreExecuteHook interface {
	OnOperationPreExecute(ctx context.Context)
}

type OperationPostExecuteHook interface {
	OnOperationPostExecute(ctx context.Context)
}

// hookRegistry holds the list of hooks for each type.
type hookRegistry struct {
	applicationStartHooks *utils.OrderedSet[ApplicationStartHook]
	applicationStopHooks  *utils.OrderedSet[ApplicationStopHook]

	graphQLServerStartHooks *utils.OrderedSet[GraphQLServerStartHook]
	graphQLServerStopHooks  *utils.OrderedSet[GraphQLServerStopHook]

	routerRequestHooks  *utils.OrderedSet[RouterRequestHook]
	routerResponseHooks *utils.OrderedSet[RouterResponseHook]

	subgraphRequestHooks  *utils.OrderedSet[SubgraphRequestHook]
	subgraphResponseHooks *utils.OrderedSet[SubgraphResponseHook]

	operationRequestHooks  *utils.OrderedSet[OperationRequestHook]
	operationResponseHooks *utils.OrderedSet[OperationResponseHook]

	operationPreParseHooks  *utils.OrderedSet[OperationPreParseHook]
	operationPostParseHooks *utils.OrderedSet[OperationPostParseHook]

	operationPreNormalizeHooks  *utils.OrderedSet[OperationPreNormalizeHook]
	operationPostNormalizeHooks *utils.OrderedSet[OperationPostNormalizeHook]

	operationPreValidateHooks  *utils.OrderedSet[OperationPreValidateHook]
	operationPostValidateHooks *utils.OrderedSet[OperationPostValidateHook]

	operationPrePlanHooks  *utils.OrderedSet[OperationPrePlanHook]
	operationPostPlanHooks *utils.OrderedSet[OperationPostPlanHook]

	operationPreExecuteHooks  *utils.OrderedSet[OperationPreExecuteHook]
	operationPostExecuteHooks *utils.OrderedSet[OperationPostExecuteHook]
}

// newHookRegistry initializes with empty sets.
func newHookRegistry() *hookRegistry {
	return &hookRegistry{
		applicationStartHooks:       utils.NewOrderedSet[ApplicationStartHook](),
		applicationStopHooks:        utils.NewOrderedSet[ApplicationStopHook](),

		graphQLServerStartHooks:     utils.NewOrderedSet[GraphQLServerStartHook](),
		graphQLServerStopHooks:      utils.NewOrderedSet[GraphQLServerStopHook](),

		routerRequestHooks:          utils.NewOrderedSet[RouterRequestHook](),
		routerResponseHooks:         utils.NewOrderedSet[RouterResponseHook](),

		subgraphRequestHooks:        utils.NewOrderedSet[SubgraphRequestHook](),
		subgraphResponseHooks:       utils.NewOrderedSet[SubgraphResponseHook](),

		operationRequestHooks:    utils.NewOrderedSet[OperationRequestHook](),
		operationResponseHooks:   utils.NewOrderedSet[OperationResponseHook](),

		operationPreParseHooks:      utils.NewOrderedSet[OperationPreParseHook](),
		operationPostParseHooks:     utils.NewOrderedSet[OperationPostParseHook](),

		operationPreNormalizeHooks:  utils.NewOrderedSet[OperationPreNormalizeHook](),
		operationPostNormalizeHooks: utils.NewOrderedSet[OperationPostNormalizeHook](),

		operationPreValidateHooks:   utils.NewOrderedSet[OperationPreValidateHook](),
		operationPostValidateHooks:  utils.NewOrderedSet[OperationPostValidateHook](),

		operationPrePlanHooks:       utils.NewOrderedSet[OperationPrePlanHook](),
		operationPostPlanHooks:      utils.NewOrderedSet[OperationPostPlanHook](),

		operationPreExecuteHooks:    utils.NewOrderedSet[OperationPreExecuteHook](),
		operationPostExecuteHooks:   utils.NewOrderedSet[OperationPostExecuteHook](),
	}
}

// registerHook is a helper to add any hook type if implemented.
func registerHook[H comparable](inst any, set *utils.OrderedSet[H]) {
	if h, ok := inst.(H); ok {
		set.Add(h)
	}
}

// AddApplicationLifecycle wires up start/stop hooks.
func (hr *hookRegistry) AddApplicationLifecycle(inst any) {
	registerHook(inst, hr.applicationStartHooks)
	registerHook(inst, hr.applicationStopHooks)
}

// AddGraphQLServerLifecycle wires up GraphQL server start/stop hooks.
func (hr *hookRegistry) AddGraphQLServerLifecycle(inst any) {
	registerHook(inst, hr.graphQLServerStartHooks)
	registerHook(inst, hr.graphQLServerStopHooks)
}

// AddRouterLifecycle wires up router request/response hooks.
func (hr *hookRegistry) AddRouterLifecycle(inst any) {
	registerHook(inst, hr.routerRequestHooks)
	registerHook(inst, hr.routerResponseHooks)
}

// AddSubgraphLifecycle wires up subgraph request/response hooks.
func (hr *hookRegistry) AddSubgraphLifecycle(inst any) {
	registerHook(inst, hr.subgraphRequestHooks)
	registerHook(inst, hr.subgraphResponseHooks)
}

// AddOperationLifecycle wires up all operation lifecycle hooks.
func (hr *hookRegistry) AddOperationLifecycle(inst any) {
	registerHook(inst, hr.operationRequestHooks)
	registerHook(inst, hr.operationResponseHooks)
	registerHook(inst, hr.operationPreParseHooks)
	registerHook(inst, hr.operationPostParseHooks)
	registerHook(inst, hr.operationPreNormalizeHooks)
	registerHook(inst, hr.operationPostNormalizeHooks)
	registerHook(inst, hr.operationPreValidateHooks)
	registerHook(inst, hr.operationPostValidateHooks)
	registerHook(inst, hr.operationPrePlanHooks)
	registerHook(inst, hr.operationPostPlanHooks)
	registerHook(inst, hr.operationPreExecuteHooks)
	registerHook(inst, hr.operationPostExecuteHooks)
}

// a helper middleware that runs RouterRequestHook/RouterResponseHook around only the /graphql endpoint.
func RouterHooksMiddleware(
    graphqlPath string,
    hooks *hookRegistry,
	logger *zap.Logger,
) func(next http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if !isGraphQLRequest(r, graphqlPath) && !isWebsocketRequest(r) { // skip subscriptions for now
                next.ServeHTTP(w, r)
                return
            }
			requestLogger := logger.With(logging.WithRequestID(middleware.GetReqID(r.Context())))
			if batchedOperationId, ok := r.Context().Value(BatchedOperationId{}).(string); ok {
				requestLogger = requestLogger.With(logging.WithBatchedRequestOperationID(batchedOperationId))
			}
			reqContext := getRequestContext(r.Context())
			if reqContext != nil {
				requestLogger = reqContext.logger
			}

			logger.Debug("Firing RouterRequest hooks")
            for _, h := range hooks.routerRequestHooks.Values() {
                if err := h.OnRouterRequest(reqContext, &RouterRequestParams{
                    HttpRequest: r,
                    Logger:      requestLogger,
                }); err != nil {
                    http.Error(w, err.Error(), http.StatusForbidden)
                    return
                }
            }
			// if there's no response hooks, we skip the rest of the middleware
			if len(hooks.routerResponseHooks.Values()) == 0 {
				next.ServeHTTP(w, r)
				return
			}

            wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
            wrapped.Discard()
            var buf bytes.Buffer
            wrapped.Tee(&buf)

            var exitErr *ExitError
            func() {
                defer func() {
                    if rec := recover(); rec != nil {
                        var err error
                        if e, ok := rec.(error); ok {
                            err = e
                        } else {
                            err = fmt.Errorf("%v", rec)
                        }
                        exitErr = &ExitError{Code: http.StatusInternalServerError, Err: err}
                    }
                }()
                next.ServeHTTP(wrapped, r)
            }()

            originalResp := &http.Response{
                StatusCode: wrapped.Status(),
                Header:     wrapped.Header().Clone(),
                Body:       io.NopCloser(bytes.NewReader(buf.Bytes())),
            }
            controller := &routerResponseController{
                recorder: responseRecorder{
                    HeaderMap: wrapped.Header().Clone(),
                    Body:      buf.Bytes(),
                    Code:      wrapped.Status(),
                },
            }
            params := &RouterResponseParams{
                RouterRequestParams: RouterRequestParams{
                    HttpRequest: r,
                    Logger:      requestLogger,
                },
                HttpResponse: originalResp,
                Controller:   controller,
            }

			logger.Debug("Firing RouterResponse hooks")
            for _, h := range hooks.routerResponseHooks.Values() {
                if err := h.OnRouterResponse(reqContext, params, exitErr); err != nil {
                    http.Error(w, err.Error(), http.StatusInternalServerError)
                    return
                }
            }

			logger.Debug("Setting response after RouterResponse hooks")
            newBody := controller.GetBody()
            w.Header().Set("Content-Length", strconv.Itoa(len(newBody)))
            for key, vals := range controller.GetHeaderMap() {
                for _, v := range vals {
                    w.Header().Add(key, v)
                }
            }
            w.WriteHeader(controller.GetStatusCode())
            w.Write(newBody)
        })
    }
}

func isWebsocketRequest(r *http.Request) bool {
	return strings.EqualFold(r.Header.Get("Connection"), "Upgrade") &&
	strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
}

func isGraphQLRequest(r *http.Request, graphqlPath string) bool {
	return r.URL.Path == graphqlPath
}
