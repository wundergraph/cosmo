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

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

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

func GetProvider(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) (datasource.PubSubProvider, error) {
	providers := make(map[string]AdapterInterface)
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Kafka {
		definedProviders[provider.ID] = true
	}
	usedProviders := make(map[string]bool)
	if kafkaData := in.GetCustomEvents().GetKafka(); kafkaData != nil {
		for _, event := range kafkaData {
			if !definedProviders[event.EngineEventConfiguration.ProviderId] {
				return nil, fmt.Errorf("failed to find Kafka provider with ID %s", event.EngineEventConfiguration.ProviderId)
			}
			usedProviders[event.EngineEventConfiguration.ProviderId] = true
		}

		for _, provider := range config.Providers.Kafka {
			if !usedProviders[provider.ID] {
				continue
			}
			options, err := buildKafkaOptions(provider)
			if err != nil {
				return nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
			}
			adapter, err := NewAdapter(ctx, logger, options)
			if err != nil {
				return nil, fmt.Errorf("failed to create adapter for Kafka provider with ID \"%s\": %w", provider.ID, err)
			}
			providers[provider.ID] = adapter
		}

		return &PubSubProvider{
			EventConfiguration: kafkaData,
			Logger:             logger,
			Providers:          providers,
		}, nil
	}

	return nil, nil
}

type PubSubProvider struct {
	EventConfiguration []*nodev1.KafkaEventConfiguration
	Logger             *zap.Logger
	Providers          map[string]AdapterInterface
}

func (c *PubSubProvider) FindPubSubDataSource(typeName string, fieldName string, extractFn datasource.ArgumentTemplateCallback) (datasource.PubSubDataSource, error) {
	for _, cfg := range c.EventConfiguration {
		if cfg.GetEngineEventConfiguration().GetTypeName() == typeName && cfg.GetEngineEventConfiguration().GetFieldName() == fieldName {
			return &PubSubDataSource{
				KafkaAdapter:       c.Providers[cfg.GetEngineEventConfiguration().GetProviderId()],
				EventConfiguration: cfg,
			}, nil
		}
	}
	return nil, nil
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	for _, provider := range c.Providers {
		if err := provider.Startup(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	for _, provider := range c.Providers {
		if err := provider.Shutdown(ctx); err != nil {
			return err
		}
	}
	return nil
}
