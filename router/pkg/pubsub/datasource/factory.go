package datasource

import (
	"context"

	"github.com/jensneuse/abstractlogger"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

func NewFactory[EC EventConfigType, P any](executionContext context.Context, config config.EventsConfiguration, providers map[string]P) *Factory[EC, P] {
	return &Factory[EC, P]{
		providers:        providers,
		executionContext: executionContext,
		config:           config,
	}
}

type Factory[EC EventConfigType, P any] struct {
	providers        map[string]P
	executionContext context.Context
	config           config.EventsConfiguration
}

func (f *Factory[EC, P]) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[Implementer[EC, P]] {
	return &Planner[EC, P]{
		providers: f.providers,
	}
}

func (f *Factory[EC, P]) Context() context.Context {
	return f.executionContext
}

func (f *Factory[EC, P]) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[Implementer[EC, P]]) (*ast.Document, bool) {
	return nil, false
}
