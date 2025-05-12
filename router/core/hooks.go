package core

import (
	"context"

	"github.com/wundergraph/cosmo/router/internal/utils"
)

// Application Lifecycle Hooks
type ApplicationLifecycleHook interface {
	ApplicationStartHook
	ApplicationStopHook
}

type ApplicationStartHook interface {
	OnApplicationStart(ctx context.Context)
}

type ApplicationStopHook interface {
	OnApplicationStop(ctx context.Context)
}

// GraphQL Server Lifecycle Hooks
type GraphQLServerLifecycleHook interface {
	GraphQLServerStartHook
	GraphQLServerStopHook
}

type GraphQLServerStartHook interface {
	OnGraphQLServerStart(ctx context.Context)
}

type GraphQLServerStopHook interface {
	OnGraphQLServerStop(ctx context.Context)
}

// Router Lifecycle Hooks
type RouterRequestHook interface {
	OnRouterRequest(ctx context.Context)
}

type RouterResponseHook interface {
	OnRouterResponse(ctx context.Context)
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

type OperationParseLifecycleHook interface {
	OperationPreParseHook
	OperationPostParseHook
}

type OperationPreParseHook interface {
	OnOperationPreParse(ctx context.Context)
}

type OperationPostParseHook interface {
	OnOperationPostParse(ctx context.Context)
}

type OperationNormalizeLifecycleHook interface {
	OperationPreNormalizeHook
	OperationPostNormalizeHook
}

type OperationPreNormalizeHook interface {
	OnOperationPreNormalize(ctx context.Context)
}

type OperationPostNormalizeHook interface {
	OnOperationPostNormalize(ctx context.Context)
}

type OperationValidateLifecycleHook interface {
	OperationPreValidateHook
	OperationPostValidateHook
}

type OperationPreValidateHook interface {
	OnOperationPreValidate(ctx context.Context)
}

type OperationPostValidateHook interface {
	OnOperationPostValidate(ctx context.Context)
}

type OperationPlanLifecycleHook interface {
	OperationPrePlanHook
	OperationPostPlanHook
}

type OperationPrePlanHook interface {
	OnOperationPrePlan(ctx context.Context)
}

type OperationPostPlanHook interface {
	OnOperationPostPlan(ctx context.Context)
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

