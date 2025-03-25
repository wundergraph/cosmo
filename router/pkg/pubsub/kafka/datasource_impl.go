package kafka

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type Configuration struct {
	Data               string `json:"data"`
	EventConfiguration []*nodev1.KafkaEventConfiguration
	Logger             *zap.Logger
}

func (c *Configuration) GetEventsDataConfigurations() []*nodev1.KafkaEventConfiguration {
	return c.EventConfiguration
}

func (c *Configuration) GetResolveDataSource(eventConfig *nodev1.KafkaEventConfiguration, pubsub *KafkaPubSub) (resolve.DataSource, error) {
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

func (c *Configuration) GetResolveDataSourceSubscription(eventConfig *nodev1.KafkaEventConfiguration, pubsub *KafkaPubSub) (resolve.SubscriptionDataSource, error) {
	return &SubscriptionSource{
		pubSub: pubsub,
	}, nil
}

func (c *Configuration) GetResolveDataSourceSubscriptionInput(eventConfig *nodev1.KafkaEventConfiguration, pubsub *KafkaPubSub) (string, error) {
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
