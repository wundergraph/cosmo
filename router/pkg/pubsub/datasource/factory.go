package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewFactory(executionContext context.Context, pubSubDataSourceMatcher PubSubDataSourceMatcherFn) *Factory {
	return &Factory{
		pubSubDataSourceMatcher: pubSubDataSourceMatcher,
		executionContext:        executionContext,
	}
}

type Factory struct {
	pubSubDataSourceMatcher PubSubDataSourceMatcherFn
	executionContext        context.Context
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[PubSubDataSourceMatcherFn] {
	return &Planner{
		pubSubDataSourceMatcher: f.pubSubDataSourceMatcher,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[PubSubDataSourceMatcherFn]) (*ast.Document, bool) {
	return nil, false
}
