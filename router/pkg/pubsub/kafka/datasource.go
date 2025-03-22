package kafka

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

func GetPlanDataSource(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger) (plan.DataSource, error) {
	if kafkaData := in.GetCustomEvents().GetKafka(); kafkaData != nil {
		k := NewPubSub(logger)
		err := k.PrepareProviders(ctx, in, dsMeta, config)
		if err != nil {
			return nil, err
		}
		factory := k.GetFactory(ctx, config)
		ds, err := plan.NewDataSourceConfiguration[datasource.Implementer[*nodev1.KafkaEventConfiguration, *kafkaPubSub]](
			in.Id,
			factory,
			dsMeta,
			&Configuration{
				EventConfiguration: kafkaData,
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
	datasource.RegisterPubSub(GetPlanDataSource)
}

type Kafka struct {
	logger    *zap.Logger
	providers map[string]*kafkaPubSub
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
	return nil
}

func (k *Kafka) GetFactory(executionContext context.Context, config config.EventsConfiguration) *datasource.Factory[*nodev1.KafkaEventConfiguration, *kafkaPubSub] {
	return datasource.NewFactory[*nodev1.KafkaEventConfiguration](executionContext, config, k.providers)
}

func NewPubSub(logger *zap.Logger) Kafka {
	return Kafka{
		providers: map[string]*kafkaPubSub{},
		logger:    logger,
	}
}

type Configuration struct {
	Data               string `json:"data"`
	EventConfiguration []*nodev1.KafkaEventConfiguration
	Logger             *zap.Logger
}

func (c *Configuration) GetEventsDataConfigurations() []*nodev1.KafkaEventConfiguration {
	return c.EventConfiguration
}

func (c *Configuration) GetResolveDataSource(eventConfig *nodev1.KafkaEventConfiguration, pubsub *kafkaPubSub) (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	typeName := eventConfig.GetEngineEventConfiguration().GetType()
	switch typeName {
	case nodev1.EventType_PUBLISH:
		dataSource = &KafkaPublishDataSource{
			pubSub: pubsub,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Kafka", typeName.String())
	}

	return dataSource, nil
}

func (c *Configuration) GetResolveDataSourceSubscription(eventConfig *nodev1.KafkaEventConfiguration, pubsub *kafkaPubSub) (resolve.SubscriptionDataSource, error) {
	return &SubscriptionSource{
		pubSub: pubsub,
	}, nil
}

func (c *Configuration) GetResolveDataSourceSubscriptionInput(eventConfig *nodev1.KafkaEventConfiguration, pubsub *kafkaPubSub) (string, error) {
	providerId := c.GetProviderId(eventConfig)
	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Topics:     eventConfig.GetTopics(),
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

func (c *Configuration) GetResolveDataSourceInput(eventConfig *nodev1.KafkaEventConfiguration, event []byte) (string, error) {
	topics := eventConfig.GetTopics()

	if len(topics) != 1 {
		return "", fmt.Errorf("publish and request events should define one topic but received %d", len(topics))
	}

	topic := topics[0]

	providerId := c.GetProviderId(eventConfig)

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Topic:      topic,
		Data:       event,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *Configuration) GetProviderId(eventConfig *nodev1.KafkaEventConfiguration) string {
	return eventConfig.GetEngineEventConfiguration().GetProviderId()
}

func (c *Configuration) FindEventConfig(eventConfigs []*nodev1.KafkaEventConfiguration, typeName string, fieldName string, fn datasource.ArgumentTemplateCallback) (*nodev1.KafkaEventConfiguration, error) {
	for _, cfg := range eventConfigs {
		if cfg.GetEngineEventConfiguration().GetTypeName() == typeName && cfg.GetEngineEventConfiguration().GetFieldName() == fieldName {
			return cfg, nil
		}
	}
	return nil, fmt.Errorf("failed to find event config for type name \"%s\" and field name \"%s\"", typeName, fieldName)
}
