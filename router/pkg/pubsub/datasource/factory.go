package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewFactory(executionContext context.Context, config config.EventsConfiguration, providers PubSubGeneralImplementerList) *Factory {
	return &Factory{
		providers:        providers,
		executionContext: executionContext,
		config:           config,
	}
}

type Factory struct {
	providers        PubSubGeneralImplementerList
	executionContext context.Context
	config           config.EventsConfiguration
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[PubSubGeneralImplementerList] {
	return &Planner{
		pubSubs: f.providers,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[PubSubGeneralImplementerList]) (*ast.Document, bool) {
	return nil, false
}
