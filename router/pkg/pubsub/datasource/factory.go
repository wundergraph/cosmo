package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewFactory(executionContext context.Context, config config.EventsConfiguration, providers []PubSubProvider) *Factory {
	return &Factory{
		providers:        providers,
		executionContext: executionContext,
		config:           config,
	}
}

type Factory struct {
	providers        []PubSubProvider
	executionContext context.Context
	config           config.EventsConfiguration
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[[]PubSubProvider] {
	return &Planner{
		providers: f.providers,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[[]PubSubProvider]) (*ast.Document, bool) {
	return nil, false
}
