package nats

import (
	"bytes"
	"context"
	"fmt"

	"github.com/jensneuse/abstractlogger"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type Nats struct{}

func (n *Nats) VerifyConfig(in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error {
	providers := map[string]bool{}
	for _, provider := range config.Providers.Nats {
		providers[provider.ID] = true
	}
	for _, event := range in.CustomEvents.GetNats() {
		if !providers[event.EngineEventConfiguration.ProviderId] {
			return fmt.Errorf("failed to find Nats provider with ID %s", event.EngineEventConfiguration.ProviderId)
		}
	}
	return nil
}

func (n *Nats) GetFactory(executionContext context.Context, config config.EventsConfiguration) *Factory {
	return NewFactory(executionContext, config)
}

func NewPubSub() Nats {
	return Nats{}
}

type Configuration struct {
	Data string `json:"data"`
}

type Planner struct {
	id     int
	config Configuration
}

func (p *Planner) SetID(id int) {
	p.id = id
}

func (p *Planner) ID() (id int) {
	return p.id
}

func (p *Planner) DownstreamResponseFieldAlias(downstreamFieldRef int) (alias string, exists bool) {
	// skip, not required
	return
}

func (p *Planner) DataSourcePlanningBehavior() plan.DataSourcePlanningBehavior {
	return plan.DataSourcePlanningBehavior{
		MergeAliasedRootNodes:      false,
		OverrideFieldPathFromAlias: false,
	}
}

func (p *Planner) Register(_ *plan.Visitor, configuration plan.DataSourceConfiguration[Configuration], _ plan.DataSourcePlannerConfiguration) error {
	p.config = configuration.CustomConfiguration()
	return nil
}

func (p *Planner) ConfigureFetch() resolve.FetchConfiguration {
	return resolve.FetchConfiguration{
		Input:      p.config.Data,
		DataSource: Source{},
	}
}

func (p *Planner) ConfigureSubscription() plan.SubscriptionConfiguration {
	return plan.SubscriptionConfiguration{
		Input: p.config.Data,
	}
}

type Source struct{}

func (Source) Load(ctx context.Context, input []byte, out *bytes.Buffer) (err error) {
	_, err = out.Write(input)
	return
}

func (Source) LoadWithFiles(ctx context.Context, input []byte, files []*httpclient.FileUpload, out *bytes.Buffer) (err error) {
	panic("not implemented")
}

func NewFactory(executionContext context.Context, config config.EventsConfiguration) *Factory {
	return &Factory{
		executionContext:    executionContext,
		eventsConfiguration: config,
	}
}

type Factory struct {
	config              Configuration
	eventsConfiguration config.EventsConfiguration
	executionContext    context.Context
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[Configuration] {
	return &Planner{
		config: f.config,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[Configuration]) (*ast.Document, bool) {
	return nil, false
}
