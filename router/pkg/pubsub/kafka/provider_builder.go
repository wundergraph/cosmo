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

type PubSubProviderBuilder struct {
	ctx              context.Context
	config           []config.KafkaEventSource
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
	adapters         map[string]AdapterInterface
}

func (p *PubSubProviderBuilder) TypeID() string {
	return providerTypeID
}

func (p *PubSubProviderBuilder) BuildDataSource(data *nodev1.KafkaEventConfiguration) (datasource.PubSubDataSource, error) {
	providerId := data.GetEngineEventConfiguration().GetProviderId()
	adapter, ok := p.adapters[providerId]
	if !ok {
		return nil, fmt.Errorf("failed to get adapter for provider %s with ID %s", p.TypeID(), providerId)
	}

	return &PubSubDataSource{
		EventConfiguration: data,
		KafkaAdapter:       adapter,
	}, nil
}

func (p *PubSubProviderBuilder) BuildProvider(provider config.KafkaEventSource) (datasource.PubSubProvider, error) {
	if p.adapters == nil {
		p.adapters = make(map[string]AdapterInterface)
	}

	if provider.ID == "" {
		return nil, fmt.Errorf("provider ID is empty")
	}

	// create providers
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

func buildProvider(ctx context.Context, provider config.KafkaEventSource, logger *zap.Logger) (AdapterInterface, datasource.PubSubProvider, error) {
	options, err := buildKafkaOptions(provider)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewAdapter(ctx, logger, options)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	pubSubProvider := &PubSubProvider{
		id:      provider.ID,
		Adapter: adapter,
		Logger:  logger,
	}

	return adapter, pubSubProvider, nil
}

func NewPubSubProviderBuilder(
	ctx context.Context,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) datasource.PubSubProviderBuilder[config.KafkaEventSource, *nodev1.KafkaEventConfiguration] {
	return &PubSubProviderBuilder{
		ctx:              ctx,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
}
