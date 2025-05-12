package kafka

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource struct {
	EventConfiguration  *nodev1.KafkaEventConfiguration
	EventConfigurations []*nodev1.KafkaEventConfiguration
	KafkaAdapters       map[string]AdapterInterface
}

func (c *PubSubDataSource) SetCurrentField(typeName string, fieldName string, extractFn datasource.ArgumentTemplateCallback) error {
	for _, event := range c.EventConfigurations {
		if event.GetEngineEventConfiguration().GetTypeName() == typeName && event.GetEngineEventConfiguration().GetFieldName() == fieldName {
			var newTopics []string
			for _, topic := range event.GetTopics() {
				newTopic, err := extractFn(topic)
				if err != nil {
					return err
				}
				newTopics = append(newTopics, newTopic)
			}
			event.Topics = newTopics
			c.EventConfiguration = event

			return nil
		}
	}

	if c.EventConfiguration == nil {
		return fmt.Errorf("failed to find event configuration for typeName: %s, fieldName: %s", typeName, fieldName)
	}

	return nil
}

func (c *PubSubDataSource) EngineEventConfiguration() *nodev1.EngineEventConfiguration {
	return c.EventConfiguration.GetEngineEventConfiguration()
}

func (c *PubSubDataSource) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	eventType := c.EventConfiguration.GetEngineEventConfiguration().GetType()
	switch eventType {
	case nodev1.EventType_PUBLISH:
		dataSource = &PublishDataSource{
			pubSub: c.KafkaAdapters[c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()],
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Kafka", eventType.String())
	}

	return dataSource, nil
}

func (c *PubSubDataSource) ResolveDataSourceInput(eventData []byte) (string, error) {
	topics := c.EventConfiguration.GetTopics()

	if len(topics) != 1 {
		return "", fmt.Errorf("publish events should define one topic but received %d", len(topics))
	}

	topic := topics[0]

	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Topic:      topic,
		Data:       eventData,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *PubSubDataSource) ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionDataSource{
		pubSub: c.KafkaAdapters[c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()],
	}, nil
}

func (c *PubSubDataSource) ResolveDataSourceSubscriptionInput() (string, error) {
	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()
	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Topics:     c.EventConfiguration.GetTopics(),
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

type SubscriptionEventConfiguration struct {
	ProviderID string   `json:"providerId"`
	Topics     []string `json:"topics"`
}

type PublishEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Topic      string          `json:"topic"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() string {
	return fmt.Sprintf(`{"topic":"%s", "data": %s, "providerId":"%s"}`, s.Topic, s.Data, s.ProviderID)
}
