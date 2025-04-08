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

func GetPlanDataSource(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) (datasource.PubSubGeneralImplementer, error) {
	if kafkaData := in.GetCustomEvents().GetKafka(); kafkaData != nil {
		k := NewPubSub(logger)
		err := k.PrepareProviders(ctx, in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		return k.config, nil
	}

	return nil, nil
}

func init() {
	datasource.RegisterPubSub(GetPlanDataSource)
}

// var _ datasource.PubSubImplementer[*KafkaPubSub] = &Kafka{}

type Kafka struct {
	logger    *zap.Logger
	providers map[string]*KafkaPubSub
	config    *Configuration
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

func (k *Kafka) PrepareProviders(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration) error {
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Kafka {
		definedProviders[provider.ID] = true
	}
	usedProviders := make(map[string]bool)
	for _, event := range in.CustomEvents.GetKafka() {
		if !definedProviders[event.EngineEventConfiguration.ProviderId] {
			return fmt.Errorf("failed to find Kafka provider with ID %s", event.EngineEventConfiguration.ProviderId)
		}
		usedProviders[event.EngineEventConfiguration.ProviderId] = true
	}
	for _, provider := range config.Providers.Kafka {
		if !usedProviders[provider.ID] {
			continue
		}
		options, err := buildKafkaOptions(provider)
		if err != nil {
			return fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
		}
		ps, err := NewConnector(k.logger, options)
		if err != nil {
			return fmt.Errorf("failed to create connection for Kafka provider with ID \"%s\": %w", provider.ID, err)
		}
		k.providers[provider.ID] = ps.New(ctx)
	}
	k.config = &Configuration{
		EventConfiguration: in.CustomEvents.GetKafka(),
		Logger:             k.logger,
		Providers:          k.providers,
	}
	return nil
}

func (k *Kafka) GetPubSubGeneralImplementerList() datasource.PubSubGeneralImplementer {
	return k.config
}

// func (k *Kafka) ConnectProviders(ctx context.Context) error {
// 	for _, provider := range k.providers {
// 		err := provider.Connect()
// 		if err != nil {
// 			return fmt.Errorf("failed to connect to Kafka provider with ID \"%s\": %w", provider.ID, err)
// 		}
// 	}
// 	return nil
// }

// func (k *Kafka) GetFactory(executionContext context.Context, config config.EventsConfiguration) *datasource.Factory {
// 	return datasource.NewFactory(executionContext, config, k.config)
// }

func NewPubSub(logger *zap.Logger) Kafka {
	return Kafka{
		providers: map[string]*KafkaPubSub{},
		logger:    logger,
	}
}
