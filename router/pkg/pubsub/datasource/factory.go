package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

type PlannerConfig[PB ProviderBuilder[P, E], P any, E any] struct {
	ProviderBuilder PB
	Event           E
}

func NewPlannerConfig[PB ProviderBuilder[P, E], P any, E any](providerBuilder PB, event E) *PlannerConfig[PB, P, E] {
	return &PlannerConfig[PB, P, E]{
		ProviderBuilder: providerBuilder,
		Event:           event,
	}
}

func NewPlannerFactory[PB ProviderBuilder[P, E], P any, E any](ctx context.Context, config *PlannerConfig[PB, P, E]) *PlannerFactory[PB, P, E] {
	return &PlannerFactory[PB, P, E]{
		config:           config,
		executionContext: ctx,
	}
}

type PlannerFactory[PB ProviderBuilder[P, E], P any, E any] struct {
	config           *PlannerConfig[PB, P, E]
	executionContext context.Context
}

func (f *PlannerFactory[PB, P, E]) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[*PlannerConfig[PB, P, E]] {
	return &Planner[PB, P, E]{
		config: f.config,
	}
}

func (f *PlannerFactory[PB, P, E]) Context() context.Context {
	return f.executionContext
}

func (f *PlannerFactory[PB, P, E]) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[*PlannerConfig[PB, P, E]]) (*ast.Document, bool) {
	return nil, false
}
