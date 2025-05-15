package kafka

import (
	"context"
	"crypto/tls"
	"fmt"
	"slices"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

var _ datasource.PubSubProviderBuilder[AdapterInterface] = &PubSubProviderBuilder{}

type PubSubProviderBuilder struct {
	ctx              context.Context
	config           config.EventsConfiguration
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
}

func (p *PubSubProviderBuilder) TypeID() string {
	return providerId
}

func (p *PubSubProviderBuilder) DataSource(data datasource.EngineEventConfiguration, adapters map[string]AdapterInterface) (datasource.PubSubDataSource, error) {
	kafkaEvent, ok := data.(*nodev1.KafkaEventConfiguration)
	if !ok {
		return nil, fmt.Errorf("failed to cast data to KafkaEventConfiguration")
	}
	providerId := kafkaEvent.GetEngineEventConfiguration().GetProviderId()
	return &PubSubDataSource{
		EventConfiguration: kafkaEvent,
		KafkaAdapter:       adapters[providerId],
	}, nil
}

func (p *PubSubProviderBuilder) Providers(usedProviders []string) (map[string]AdapterInterface, []datasource.PubSubProvider, error) {
	adapters := make(map[string]AdapterInterface)
	pubSubProviders := []datasource.PubSubProvider{}

	// create providers
	for _, provider := range p.config.Providers.Kafka {
		if !slices.Contains(usedProviders, provider.ID) {
			continue
		}
		adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger)
		if err != nil {
			return nil, nil, err
		}
		adapters[provider.ID] = adapter
		pubSubProviders = append(pubSubProviders, pubSubProvider)
	}

	return adapters, pubSubProviders, nil
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
