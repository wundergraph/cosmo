package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewPlannerFactory[P, E any](executionContext context.Context, pubSubDataSourceFactory *PubSubDataSourceFactory[P, E]) *PlannerFactory[P, E] {
	return &PlannerFactory[P, E]{
		pubSubDataSourceFactory: pubSubDataSourceFactory,
		executionContext:        executionContext,
	}
}

type PlannerFactory[P, E any] struct {
	pubSubDataSourceFactory *PubSubDataSourceFactory[P, E]
	executionContext        context.Context
}

func (f *PlannerFactory[P, E]) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[*PubSubDataSourceFactory[P, E]] {
	return &Planner[P, E]{
		pubSubDataSourceFactory: f.pubSubDataSourceFactory,
	}
}

func (f *PlannerFactory[P, E]) Context() context.Context {
	return f.executionContext
}

func (f *PlannerFactory[P, E]) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[*PubSubDataSourceFactory[P, E]]) (*ast.Document, bool) {
	return nil, false
}
