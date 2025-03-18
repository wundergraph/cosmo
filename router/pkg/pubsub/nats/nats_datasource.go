package nats

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jensneuse/abstractlogger"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/ast"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/httpclient"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func GetDataSource(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger) (plan.DataSource, error) {
	if natsData := in.GetCustomEvents().GetNats(); natsData != nil {
		k := NewPubSub()
		err := k.PrepareProviders(ctx, in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		factory := k.GetFactory(ctx, config, k.providers)
		ds, err := plan.NewDataSourceConfiguration[Configuration](
			in.Id,
			factory,
			dsMeta,
			Configuration{
				EventConfiguration: natsData,
				Logger:             logger,
			},
		)

		if err != nil {
			return nil, err
		}

		return ds, nil
	}

	return nil, nil
}

func init() {
	datasource.RegisterPubSub(GetDataSource)
}

func buildNatsOptions(eventSource config.NatsEventSource, logger *zap.Logger) ([]nats.Option, error) {
	opts := []nats.Option{
		nats.Name(fmt.Sprintf("cosmo.router.edfs.nats.%s", eventSource.ID)),
		nats.ReconnectJitter(500*time.Millisecond, 2*time.Second),
		nats.ClosedHandler(func(conn *nats.Conn) {
			logger.Info("NATS connection closed", zap.String("provider_id", eventSource.ID), zap.Error(conn.LastError()))
		}),
		nats.ConnectHandler(func(nc *nats.Conn) {
			logger.Info("NATS connection established", zap.String("provider_id", eventSource.ID), zap.String("url", nc.ConnectedUrlRedacted()))
		}),
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			if err != nil {
				logger.Error("NATS disconnected; will attempt to reconnect", zap.Error(err), zap.String("provider_id", eventSource.ID))
			} else {
				logger.Info("NATS disconnected", zap.String("provider_id", eventSource.ID))
			}
		}),
		nats.ErrorHandler(func(conn *nats.Conn, subscription *nats.Subscription, err error) {
			if errors.Is(err, nats.ErrSlowConsumer) {
				logger.Warn(
					"NATS slow consumer detected. Events are being dropped. Please consider increasing the buffer size or reducing the number of messages being sent.",
					zap.Error(err),
					zap.String("provider_id", eventSource.ID),
				)
			} else {
				logger.Error("NATS error", zap.Error(err))
			}
		}),
		nats.ReconnectHandler(func(conn *nats.Conn) {
			logger.Info("NATS reconnected", zap.String("provider_id", eventSource.ID), zap.String("url", conn.ConnectedUrlRedacted()))
		}),
	}

	if eventSource.Authentication != nil {
		if eventSource.Authentication.Token != nil {
			opts = append(opts, nats.Token(*eventSource.Authentication.Token))
		} else if eventSource.Authentication.UserInfo.Username != nil && eventSource.Authentication.UserInfo.Password != nil {
			opts = append(opts, nats.UserInfo(*eventSource.Authentication.UserInfo.Username, *eventSource.Authentication.UserInfo.Password))
		}
	}

	return opts, nil
}

type Nats struct {
	providers        map[string]*natsPubSub
	logger           *zap.Logger
	hostName         string // How to get it here?
	routerListenAddr string // How to get it here?
}

func (n *Nats) PrepareProviders(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error {
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Kafka {
		definedProviders[provider.ID] = true
	}
	usedProviders := make(map[string]bool)
	for _, event := range in.CustomEvents.GetNats() {
		if _, found := definedProviders[event.EngineEventConfiguration.ProviderId]; !found {
			return fmt.Errorf("failed to find Nats provider with ID %s", event.EngineEventConfiguration.ProviderId)
		}
		usedProviders[event.EngineEventConfiguration.ProviderId] = true
	}
	for _, provider := range config.Providers.Nats {
		if !usedProviders[provider.ID] {
			continue
		}
		options, err := buildNatsOptions(provider, n.logger)
		if err != nil {
			return fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", provider.ID, err)
		}
		natsConnection, err := nats.Connect(provider.URL, options...)
		if err != nil {
			return fmt.Errorf("failed to create connection for Nats provider with ID \"%s\": %w", provider.ID, err)
		}
		js, err := jetstream.New(natsConnection)
		if err != nil {
			return err
		}

		n.providers[provider.ID] = NewConnector(n.logger, natsConnection, js, n.hostName, n.routerListenAddr).New(ctx)

	}
	return nil
}

func (n *Nats) GetFactory(executionContext context.Context, config config.EventsConfiguration, providers map[string]*natsPubSub) *Factory {
	return NewFactory(executionContext, config, providers)
}

func NewPubSub() Nats {
	return Nats{}
}

type Configuration struct {
	Data               string `json:"data"`
	EventConfiguration []*nodev1.NatsEventConfiguration
	Logger             *zap.Logger
}

type Planner struct {
	id        int
	config    Configuration
	providers map[string]*natsPubSub
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

func NewFactory(executionContext context.Context, config config.EventsConfiguration, providers map[string]*natsPubSub) *Factory {
	return &Factory{
		executionContext:    executionContext,
		eventsConfiguration: config,
		providers:           providers,
	}
}

type Factory struct {
	config              Configuration
	eventsConfiguration config.EventsConfiguration
	executionContext    context.Context
	providers           map[string]*natsPubSub
}

func (f *Factory) Planner(_ abstractlogger.Logger) plan.DataSourcePlanner[Configuration] {
	return &Planner{
		config:    f.config,
		providers: f.providers,
	}
}

func (f *Factory) Context() context.Context {
	return f.executionContext
}

func (f *Factory) UpstreamSchema(dataSourceConfig plan.DataSourceConfiguration[Configuration]) (*ast.Document, bool) {
	return nil, false
}
