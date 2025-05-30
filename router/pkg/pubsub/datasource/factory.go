package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewFactory[P, E any](executionContext context.Context, pubSubDataSourceFactory *PubSubDataSourceFactory[P, E]) *Factory[P, E] {
	return &Factory[P, E]{
		pubSubDataSourceFactory: pubSubDataSourceFactory,
		executionContext:        executionContext,
	}
}

type Factory[P, E any] struct {
	pubSubDataSourceFactory *PubSubDataSourceFactory[P, E]
	executionContext        context.Context
}

func (f *Factory[P, E]) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[*PubSubDataSourceFactory[P, E]] {
	return &Planner[P, E]{
		pubSubDataSourceFactory: f.pubSubDataSourceFactory,
	}
}

func (f *Factory[P, E]) Context() context.Context {
	return f.executionContext
}

func (f *Factory[P, E]) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[*PubSubDataSourceFactory[P, E]]) (*ast.Document, bool) {
	return nil, false
}
