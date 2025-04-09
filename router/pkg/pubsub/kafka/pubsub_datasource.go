package kafka

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource struct {
	EventConfiguration *nodev1.KafkaEventConfiguration
	KafkaAdapter       AdapterInterface
}

func (c *PubSubDataSource) GetEngineEventConfiguration() *nodev1.EngineEventConfiguration {
	return c.EventConfiguration.GetEngineEventConfiguration()
}

func (c *PubSubDataSource) GetResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	typeName := c.EventConfiguration.GetEngineEventConfiguration().GetType()
	switch typeName {
	case nodev1.EventType_PUBLISH:
		dataSource = &KafkaPublishDataSource{
			pubSub: c.KafkaAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Kafka", typeName.String())
	}

	return dataSource, nil
}

func (c *PubSubDataSource) GetResolveDataSourceInput(event []byte) (string, error) {
	topics := c.EventConfiguration.GetTopics()

	if len(topics) != 1 {
		return "", fmt.Errorf("publish and request events should define one topic but received %d", len(topics))
	}

	topic := topics[0]

	providerId := c.GetProviderId()

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Topic:      topic,
		Data:       event,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *PubSubDataSource) GetResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionSource{
		pubSub: c.KafkaAdapter,
	}, nil
}

func (c *PubSubDataSource) GetResolveDataSourceSubscriptionInput() (string, error) {
	providerId := c.GetProviderId()
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

func (c *PubSubDataSource) GetProviderId() string {
	return c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()
}
