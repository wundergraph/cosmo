package redis

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

// EngineDataSourceFactory implements the datasource.EngineDataSourceFactory interface for Redis
type EngineDataSourceFactory struct {
	EventConfiguration *nodev1.RedisEventConfiguration
	RedisAdapter       Adapter
}

func (c *EngineDataSourceFactory) GetFieldName() string {
	return c.EventConfiguration.GetEngineEventConfiguration().GetFieldName()
}

// EngineEventConfiguration returns the engine event configuration
func (c *EngineDataSourceFactory) EngineEventConfiguration() *nodev1.EngineEventConfiguration {
	return c.EventConfiguration.GetEngineEventConfiguration()
}

// ResolveDataSource returns the appropriate data source based on the event type
func (c *EngineDataSourceFactory) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	eventType := c.EventConfiguration.GetEngineEventConfiguration().GetType()
	switch eventType {
	case nodev1.EventType_PUBLISH:
		dataSource = &PublishDataSource{
			pubSub: c.RedisAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Redis", eventType.String())
	}

	return dataSource, nil
}

// ResolveDataSourceInput builds the input for the data source
func (c *EngineDataSourceFactory) ResolveDataSourceInput(eventData []byte) (string, error) {
	channels := c.EventConfiguration.GetChannels()

	if len(channels) != 1 {
		return "", fmt.Errorf("publish events should define one channel but received %d", len(channels))
	}

	channel := channels[0]
	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Channel:    channel,
		Data:       eventData,
	}

	return evtCfg.MarshalJSONTemplate()
}

// ResolveDataSourceSubscription returns the subscription data source
func (c *EngineDataSourceFactory) ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionDataSource{
		pubSub: c.RedisAdapter,
	}, nil
}

// ResolveDataSourceSubscriptionInput builds the input for the subscription data source
func (c *EngineDataSourceFactory) ResolveDataSourceSubscriptionInput() (string, error) {
	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()
	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Channels:   c.EventConfiguration.GetChannels(),
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription configuration")
	}
	return string(object), nil
}

// TransformEventData transforms the event data using the extract function
func (c *EngineDataSourceFactory) TransformEventData(extractFn datasource.ArgumentTemplateCallback) error {
	// No operation needed until full proto support is added
	return nil
}
