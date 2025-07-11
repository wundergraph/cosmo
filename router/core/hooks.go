package core

import (
	"github.com/wundergraph/cosmo/router/internal/utils"
	"go.uber.org/zap"
)

// Application Lifecycle Hooks
type ApplicationLifecycleHook interface {
	ApplicationStartHook
	ApplicationStopHook
}

type ApplicationStartHook interface {
	OnApplicationStart(ctx ApplicationStartHookContext) error
}

type ApplicationStopHook interface {
	OnApplicationStop(ctx ApplicationStopHookContext) error
}

// GraphQL Server Lifecycle Hooks
type GraphQLServerLifecycleHook interface {
	GraphQLServerStartHook
	GraphQLServerStopHook
}

type GraphQLServerStartHook interface {
	OnGraphQLServerStart(ctx GraphQLServerStartHookContext) error
}

type GraphQLServerStopHook interface {
	OnGraphQLServerStop(ctx GraphQLServerStopHookContext) error
}

// Router Lifecycle Hooks
type RouterRequestHook interface {
	OnRouterRequest(ctx RouterRequestHookContext) error
}

type RouterResponseHook interface {
	OnRouterResponse(ctx RouterResponseHookContext) error
}

type RouterLifecycleHook interface {
	RouterRequestHook
	RouterResponseHook
}

// Subgraph Lifecycle Hooks
type SubgraphRequestHook interface {
	OnSubgraphRequest(ctx SubgraphRequestHookContext) error
}

type SubgraphResponseHook interface {
	OnSubgraphResponse(ctx SubgraphResponseHookContext) error
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

type OperationParseLifecycleHook interface {
	OperationPreParseHook
	OperationPostParseHook
}

type OperationPreParseHook interface {
	OnOperationPreParse(ctx OperationPreParseHookContext) error
}

type OperationPostParseHook interface {
	OnOperationPostParse(ctx OperationPostParseHookContext) error
}

type OperationNormalizeLifecycleHook interface {
	OperationPreNormalizeHook
	OperationPostNormalizeHook
}

type OperationPreNormalizeHook interface {
	OnOperationPreNormalize(ctx OperationPreNormalizeHookContext) error
}

type OperationPostNormalizeHook interface {
	OnOperationPostNormalize(ctx OperationPostNormalizeHookContext) error
}

type OperationValidateLifecycleHook interface {
	OperationPreValidateHook
	OperationPostValidateHook
}

type OperationPreValidateHook interface {
	OnOperationPreValidate(ctx OperationPreValidateHookContext) error
}

type OperationPostValidateHook interface {
	OnOperationPostValidate(ctx OperationPostValidateHookContext) error
}

type OperationPlanLifecycleHook interface {
	OperationPrePlanHook
	OperationPostPlanHook
}

type OperationPrePlanHook interface {
	OnOperationPrePlan(ctx OperationPrePlanHookContext) error
}

type OperationPostPlanHook interface {
	OnOperationPostPlan(ctx OperationPostPlanHookContext) error
}

type OperationExecuteLifecycleHook interface {
	OperationPreExecuteHook
	OperationPostExecuteHook
}

type OperationPreExecuteHook interface {
	OnOperationPreExecute(ctx OperationPreExecuteHookContext) error
}

type OperationPostExecuteHook interface {
	OnOperationPostExecute(ctx OperationPostExecuteHookContext) error
}

// moduleHook is a wrapper around a hook that includes the module ID.
// this is used for tracability in case of hook execution errors.
type moduleHook[H any] struct {
	ID   string
	Hook H
}

// hookRegistry holds the list of hooks for each type.
type hookRegistry struct {
	applicationStartHooks *utils.OrderedSet[moduleHook[ApplicationStartHook]]
	applicationStopHooks  *utils.OrderedSet[moduleHook[ApplicationStopHook]]

	graphQLServerStartHooks *utils.OrderedSet[moduleHook[GraphQLServerStartHook]]
	graphQLServerStopHooks  *utils.OrderedSet[moduleHook[GraphQLServerStopHook]]

	routerRequestHooks  *utils.OrderedSet[moduleHook[RouterRequestHook]]
	routerResponseHooks *utils.OrderedSet[moduleHook[RouterResponseHook]]

	subgraphRequestHooks  *utils.OrderedSet[moduleHook[SubgraphRequestHook]]
	subgraphResponseHooks *utils.OrderedSet[moduleHook[SubgraphResponseHook]]

	operationPreParseHooks  *utils.OrderedSet[moduleHook[OperationPreParseHook]]
	operationPostParseHooks *utils.OrderedSet[moduleHook[OperationPostParseHook]]

	operationPreNormalizeHooks  *utils.OrderedSet[moduleHook[OperationPreNormalizeHook]]
	operationPostNormalizeHooks *utils.OrderedSet[moduleHook[OperationPostNormalizeHook]]

	operationPreValidateHooks  *utils.OrderedSet[moduleHook[OperationPreValidateHook]]
	operationPostValidateHooks *utils.OrderedSet[moduleHook[OperationPostValidateHook]]

	operationPrePlanHooks  *utils.OrderedSet[moduleHook[OperationPrePlanHook]]
	operationPostPlanHooks *utils.OrderedSet[moduleHook[OperationPostPlanHook]]

	operationPreExecuteHooks  *utils.OrderedSet[moduleHook[OperationPreExecuteHook]]
	operationPostExecuteHooks *utils.OrderedSet[moduleHook[OperationPostExecuteHook]]
}

// newHookRegistry initializes with empty sets.
func newHookRegistry() *hookRegistry {
	return &hookRegistry{
		applicationStartHooks: utils.NewOrderedSet[moduleHook[ApplicationStartHook]](),
		applicationStopHooks:  utils.NewOrderedSet[moduleHook[ApplicationStopHook]](),

		graphQLServerStartHooks: utils.NewOrderedSet[moduleHook[GraphQLServerStartHook]](),
		graphQLServerStopHooks:  utils.NewOrderedSet[moduleHook[GraphQLServerStopHook]](),

		routerRequestHooks:  utils.NewOrderedSet[moduleHook[RouterRequestHook]](),
		routerResponseHooks: utils.NewOrderedSet[moduleHook[RouterResponseHook]](),

		subgraphRequestHooks:  utils.NewOrderedSet[moduleHook[SubgraphRequestHook]](),
		subgraphResponseHooks: utils.NewOrderedSet[moduleHook[SubgraphResponseHook]](),

		operationPreParseHooks:  utils.NewOrderedSet[moduleHook[OperationPreParseHook]](),
		operationPostParseHooks: utils.NewOrderedSet[moduleHook[OperationPostParseHook]](),

		operationPreNormalizeHooks:  utils.NewOrderedSet[moduleHook[OperationPreNormalizeHook]](),
		operationPostNormalizeHooks: utils.NewOrderedSet[moduleHook[OperationPostNormalizeHook]](),

		operationPreValidateHooks:  utils.NewOrderedSet[moduleHook[OperationPreValidateHook]](),
		operationPostValidateHooks: utils.NewOrderedSet[moduleHook[OperationPostValidateHook]](),

		operationPrePlanHooks:  utils.NewOrderedSet[moduleHook[OperationPrePlanHook]](),
		operationPostPlanHooks: utils.NewOrderedSet[moduleHook[OperationPostPlanHook]](),

		operationPreExecuteHooks:  utils.NewOrderedSet[moduleHook[OperationPreExecuteHook]](),
		operationPostExecuteHooks: utils.NewOrderedSet[moduleHook[OperationPostExecuteHook]](),
	}
}

// registerHook is a helper to add any hook type if implemented.
func registerHook[H comparable](inst any, set *utils.OrderedSet[moduleHook[H]], moduleID string) {
	if h, ok := inst.(H); ok {
		set.Add(moduleHook[H]{
			ID:   moduleID,
			Hook: h,
		})
	}
}

// AddApplicationLifecycle registers start/stop hooks.
func (hr *hookRegistry) AddApplicationLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.applicationStartHooks, moduleID)
	registerHook(inst, hr.applicationStopHooks, moduleID)
}

// AddGraphQLServerLifecycle registers GraphQL server start/stop hooks.
func (hr *hookRegistry) AddGraphQLServerLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.graphQLServerStartHooks, moduleID)
	registerHook(inst, hr.graphQLServerStopHooks, moduleID)
}

// AddRouterLifecycle registers router request/response hooks.
func (hr *hookRegistry) AddRouterLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.routerRequestHooks, moduleID)
	registerHook(inst, hr.routerResponseHooks, moduleID)
}

// AddSubgraphLifecycle registers subgraph request/response hooks.
func (hr *hookRegistry) AddSubgraphLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.subgraphRequestHooks, moduleID)
	registerHook(inst, hr.subgraphResponseHooks, moduleID)
}

// AddOperationLifecycle registers all operation lifecycle hooks.
func (hr *hookRegistry) AddOperationLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.operationPreParseHooks, moduleID)
	registerHook(inst, hr.operationPostParseHooks, moduleID)
	registerHook(inst, hr.operationPreNormalizeHooks, moduleID)
	registerHook(inst, hr.operationPostNormalizeHooks, moduleID)
	registerHook(inst, hr.operationPreValidateHooks, moduleID)
	registerHook(inst, hr.operationPostValidateHooks, moduleID)
	registerHook(inst, hr.operationPrePlanHooks, moduleID)
	registerHook(inst, hr.operationPostPlanHooks, moduleID)
	registerHook(inst, hr.operationPreExecuteHooks, moduleID)
	registerHook(inst, hr.operationPostExecuteHooks, moduleID)
}

// executeHooks executes the hooks in the order they were registered.
func executeHooks[H any](hooks []moduleHook[H], invoke func(H) error, hookName string, logger *zap.Logger) error {
	logger.Debug("executing hooks", zap.String("hookName", hookName), zap.Int("hooks", len(hooks)))
	for _, mk := range hooks {
		if err := invoke(mk.Hook); err != nil {
			return newModuleV1HookError(mk.ID, hookName, err)
		}
	}
	return nil
}
