package nats

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "nats"

type ProviderBuilder struct {
	ctx              context.Context
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
	adapters         map[string]Adapter
}

func (p *ProviderBuilder) TypeID() string {
	return providerTypeID
}

func (p *ProviderBuilder) BuildEngineDataSourceFactory(data *nodev1.NatsEventConfiguration) (datasource.EngineDataSourceFactory, error) {
	providerId := data.GetEngineEventConfiguration().GetProviderId()
	adapter, ok := p.adapters[providerId]
	if !ok {
		return nil, fmt.Errorf("failed to get adapter for provider %s with ID %s", p.TypeID(), providerId)
	}

	var eventType EventType
	switch data.GetEngineEventConfiguration().GetType() {
	case nodev1.EventType_PUBLISH:
		eventType = EventTypePublish
	case nodev1.EventType_SUBSCRIBE:
		eventType = EventTypeSubscribe
	case nodev1.EventType_REQUEST:
		eventType = EventTypeRequest
	default:
		return nil, fmt.Errorf("unsupported event type: %s", data.GetEngineEventConfiguration().GetType())
	}
	dataSourceFactory := &EngineDataSourceFactory{
		NatsAdapter:             adapter,
		fieldName:               data.GetEngineEventConfiguration().GetFieldName(),
		eventType:               eventType,
		subjects:                data.GetSubjects(),
		providerId:              providerId,
		withStreamConfiguration: data.GetStreamConfiguration() != nil,
	}

	if data.GetStreamConfiguration() != nil {
		dataSourceFactory.withStreamConfiguration = true
		dataSourceFactory.consumerName = data.GetStreamConfiguration().GetConsumerName()
		dataSourceFactory.streamName = data.GetStreamConfiguration().GetStreamName()
		dataSourceFactory.consumerInactiveThreshold = data.GetStreamConfiguration().GetConsumerInactiveThreshold()
	}

	return dataSourceFactory, nil
}

func (p *ProviderBuilder) BuildProvider(provider config.NatsEventSource) (datasource.Provider, error) {
	adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger, p.hostName, p.routerListenAddr)
	if err != nil {
		return nil, err
	}
	p.adapters[provider.ID] = adapter

	return pubSubProvider, nil
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

func buildProvider(ctx context.Context, provider config.NatsEventSource, logger *zap.Logger, hostName string, routerListenAddr string) (Adapter, datasource.Provider, error) {
	options, err := buildNatsOptions(provider, logger)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Nats provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewAdapter(ctx, logger, provider.URL, options, hostName, routerListenAddr)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Nats provider with ID \"%s\": %w", provider.ID, err)
	}
	pubSubProvider := datasource.NewPubSubProvider(provider.ID, providerTypeID, adapter, logger)

	return adapter, pubSubProvider, nil
}

func NewProviderBuilder(
	ctx context.Context,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) datasource.ProviderBuilder[config.NatsEventSource, *nodev1.NatsEventConfiguration] {
	return &ProviderBuilder{
		ctx:              ctx,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		adapters:         make(map[string]Adapter),
	}
}
