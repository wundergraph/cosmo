package nats

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/nats-io/nats.go"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

type PubSubProviderBuilder struct {
	ctx              context.Context
	config           []config.NatsEventSource
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
	adapters         map[string]AdapterInterface
}

func (p *PubSubProviderBuilder) TypeID() string {
	return providerTypeID
}

func (p *PubSubProviderBuilder) DataSource(data datasource.EngineEventConfiguration) (datasource.PubSubDataSource, error) {
	natsEvent, ok := data.(*nodev1.NatsEventConfiguration)
	if !ok {
		return nil, fmt.Errorf("failed to cast data to NatsEventConfiguration")
	}
	providerId := natsEvent.GetEngineEventConfiguration().GetProviderId()
	return &PubSubDataSource{
		EventConfiguration: natsEvent,
		NatsAdapter:        p.adapters[providerId],
	}, nil
}

func (p *PubSubProviderBuilder) Providers(ids []string) ([]datasource.PubSubProvider, error) {
	p.adapters = make(map[string]AdapterInterface)
	pubSubProviders := []datasource.PubSubProvider{}

	// create providers
	for _, provider := range p.config {
		if !slices.Contains(ids, provider.ID) {
			continue
		}
		adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger, p.hostName, p.routerListenAddr)
		if err != nil {
			return nil, err
		}
		p.adapters[provider.ID] = adapter
		pubSubProviders = append(pubSubProviders, pubSubProvider)
	}

	for _, id := range ids {
		if _, ok := p.adapters[id]; !ok {
			return nil, fmt.Errorf("%s provider with ID %s is not defined", p.TypeID(), id)
		}
	}

	return pubSubProviders, nil
}

func (p *PubSubProviderBuilder) EngineEventConfigurations(in *nodev1.DataSourceConfiguration) []datasource.EngineEventConfiguration {
	natsData := make([]datasource.EngineEventConfiguration, 0, len(in.GetCustomEvents().GetNats()))
	for _, natsEvent := range in.GetCustomEvents().GetNats() {
		natsData = append(natsData, natsEvent)
	}

	return natsData
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

func buildProvider(ctx context.Context, provider config.NatsEventSource, logger *zap.Logger, hostName string, routerListenAddr string) (AdapterInterface, datasource.PubSubProvider, error) {
	options, err := buildNatsOptions(provider, logger)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewAdapter(ctx, logger, provider.URL, options, hostName, routerListenAddr)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Nats provider with ID \"%s\": %w", provider.ID, err)
	}
	pubSubProvider := &PubSubProvider{
		id:      provider.ID,
		Adapter: adapter,
		Logger:  logger,
	}

	return adapter, pubSubProvider, nil
}

func PubSubProviderBuilderFactory(
	ctx context.Context,
	config config.EventsConfiguration,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) datasource.PubSubProviderBuilder {
	return &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config.Providers.Nats,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
}
