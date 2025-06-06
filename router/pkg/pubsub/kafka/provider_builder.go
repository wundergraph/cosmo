package kafka

import (
	"context"
	"crypto/tls"
	"fmt"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "kafka"

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

func (p *ProviderBuilder) BuildEngineDataSourceFactory(data *nodev1.KafkaEventConfiguration) (datasource.EngineDataSourceFactory, error) {
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
	default:
		return nil, fmt.Errorf("unsupported event type: %s", data.GetEngineEventConfiguration().GetType())
	}

	return &EngineDataSourceFactory{
		fieldName:    data.GetEngineEventConfiguration().GetFieldName(),
		eventType:    eventType,
		topics:       data.GetTopics(),
		providerId:   providerId,
		KafkaAdapter: adapter,
	}, nil
}

func (p *ProviderBuilder) BuildProvider(provider config.KafkaEventSource) (datasource.Provider, error) {
	adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger)
	if err != nil {
		return nil, err
	}

	p.adapters[provider.ID] = adapter

	return pubSubProvider, nil
}

// buildKafkaOptions creates a list of kgo.Opt options for the given Kafka event source configuration.
// Only general options like TLS, SASL, etc. are configured here. Specific options like topics, etc. are
// configured in the KafkaPubSub implementation.
func buildKafkaOptions(eventSource config.KafkaEventSource) ([]kgo.Opt, error) {
	opts := []kgo.Opt{
		kgo.SeedBrokers(eventSource.Brokers...),
		// Ensure proper timeouts are set
		kgo.ProduceRequestTimeout(10 * time.Second),
		kgo.ConnIdleTimeout(60 * time.Second),
	}

	if eventSource.TLS != nil && eventSource.TLS.Enabled {
		opts = append(opts,
			// Configure TLS. Uses SystemCertPool for RootCAs by default.
			kgo.DialTLSConfig(new(tls.Config)),
		)
	}

	if eventSource.Authentication != nil && eventSource.Authentication.SASLPlain.Username != nil && eventSource.Authentication.SASLPlain.Password != nil {
		opts = append(opts, kgo.SASL(plain.Auth{
			User: *eventSource.Authentication.SASLPlain.Username,
			Pass: *eventSource.Authentication.SASLPlain.Password,
		}.AsMechanism()))
	}

	return opts, nil
}

func buildProvider(ctx context.Context, provider config.KafkaEventSource, logger *zap.Logger) (Adapter, datasource.Provider, error) {
	options, err := buildKafkaOptions(provider)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewProviderAdapter(ctx, logger, options)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	pubSubProvider := datasource.NewPubSubProvider(provider.ID, providerTypeID, adapter, logger)

	return adapter, pubSubProvider, nil
}

func NewProviderBuilder(
	ctx context.Context,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) *ProviderBuilder {
	return &ProviderBuilder{
		ctx:              ctx,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		adapters:         make(map[string]Adapter),
	}
}
