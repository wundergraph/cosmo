package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewFactory(executionContext context.Context, pubSubDataSource PubSubDataSource) *Factory {
	return &Factory{
		pubSubDataSource: pubSubDataSource,
		executionContext: executionContext,
	}
}

type Factory struct {
	pubSubDataSource PubSubDataSource
	executionContext context.Context
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[PubSubDataSource] {
	return &Planner{
		pubSubDataSource: f.pubSubDataSource,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[PubSubDataSource]) (*ast.Document, bool) {
	return nil, false
}
