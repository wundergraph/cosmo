package core

import (
	"context"
	"fmt"

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

// moduleHook is a wrapper around a hook that includes the module ID.
// this is used for tracability in case of hook execution errors.
type moduleHook[H any] struct {
	ID string
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
		applicationStartHooks:       utils.NewOrderedSet[moduleHook[ApplicationStartHook]](),
		applicationStopHooks:        utils.NewOrderedSet[moduleHook[ApplicationStopHook]](),

		graphQLServerStartHooks:     utils.NewOrderedSet[moduleHook[GraphQLServerStartHook]](),
		graphQLServerStopHooks:      utils.NewOrderedSet[moduleHook[GraphQLServerStopHook]](),

		routerRequestHooks:          utils.NewOrderedSet[moduleHook[RouterRequestHook]](),
		routerResponseHooks:         utils.NewOrderedSet[moduleHook[RouterResponseHook]](),

		subgraphRequestHooks:        utils.NewOrderedSet[moduleHook[SubgraphRequestHook]](),
		subgraphResponseHooks:       utils.NewOrderedSet[moduleHook[SubgraphResponseHook]](),

		operationPreParseHooks:      utils.NewOrderedSet[moduleHook[OperationPreParseHook]](),
		operationPostParseHooks:     utils.NewOrderedSet[moduleHook[OperationPostParseHook]](),

		operationPreNormalizeHooks:  utils.NewOrderedSet[moduleHook[OperationPreNormalizeHook]](),
		operationPostNormalizeHooks: utils.NewOrderedSet[moduleHook[OperationPostNormalizeHook]](),

		operationPreValidateHooks:   utils.NewOrderedSet[moduleHook[OperationPreValidateHook]](),
		operationPostValidateHooks:  utils.NewOrderedSet[moduleHook[OperationPostValidateHook]](),

		operationPrePlanHooks:       utils.NewOrderedSet[moduleHook[OperationPrePlanHook]](),
		operationPostPlanHooks:      utils.NewOrderedSet[moduleHook[OperationPostPlanHook]](),

		operationPreExecuteHooks:    utils.NewOrderedSet[moduleHook[OperationPreExecuteHook]](),
		operationPostExecuteHooks:   utils.NewOrderedSet[moduleHook[OperationPostExecuteHook]](),
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

// AddApplicationLifecycle wires up start/stop hooks.
func (hr *hookRegistry) AddApplicationLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.applicationStartHooks, moduleID)
	registerHook(inst, hr.applicationStopHooks, moduleID)
}

// AddGraphQLServerLifecycle wires up GraphQL server start/stop hooks.
func (hr *hookRegistry) AddGraphQLServerLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.graphQLServerStartHooks, moduleID)
	registerHook(inst, hr.graphQLServerStopHooks, moduleID)
}

// AddRouterLifecycle wires up router request/response hooks.
func (hr *hookRegistry) AddRouterLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.routerRequestHooks, moduleID)
	registerHook(inst, hr.routerResponseHooks, moduleID)
}

// AddSubgraphLifecycle wires up subgraph request/response hooks.
func (hr *hookRegistry) AddSubgraphLifecycle(inst any, moduleID string) {
	registerHook(inst, hr.subgraphRequestHooks, moduleID)
	registerHook(inst, hr.subgraphResponseHooks, moduleID)
}

// AddOperationLifecycle wires up all operation lifecycle hooks.
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
func executeHooks[H any](ctx context.Context, hooks []moduleHook[H], invoke func(H) error, hookName string) error {
	for _, mk := range hooks{
		if err := invoke(mk.Hook); err != nil {
			return fmt.Errorf("failed to run hook %s of module %s: %w", hookName, mk.ID, err)
		}
	}
	return nil
}
