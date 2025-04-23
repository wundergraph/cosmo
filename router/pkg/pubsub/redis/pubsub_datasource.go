package redis

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource struct {
	EventConfiguration *nodev1.RedisEventConfiguration
	RedisAdapter       AdapterInterface
}

func (c *PubSubDataSource) GetEngineEventConfiguration() *nodev1.EngineEventConfiguration {
	return c.EventConfiguration.GetEngineEventConfiguration()
}

func (c *PubSubDataSource) GetResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	typeName := c.EventConfiguration.GetEngineEventConfiguration().GetType()
	switch typeName {
	case nodev1.EventType_PUBLISH:
		dataSource = &PublishDataSource{
			pubSub: c.RedisAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Redis", typeName.String())
	}

	return dataSource, nil
}

func (c *PubSubDataSource) GetResolveDataSourceInput(event []byte) (string, error) {
	channels := c.EventConfiguration.GetChannels()

	if len(channels) != 1 {
		return "", fmt.Errorf("publish events should define one channel but received %d", len(channels))
	}

	channel := channels[0]
	providerId := c.GetProviderId()

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Channel:    channel,
		Data:       event,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *PubSubDataSource) GetResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionDataSource{
		pubSub: c.RedisAdapter,
	}, nil
}

func (c *PubSubDataSource) GetResolveDataSourceSubscriptionInput() (string, error) {
	providerId := c.GetProviderId()
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

func (c *PubSubDataSource) GetProviderId() string {
	return c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()
}

type PublishEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Channel    string          `json:"channel"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() string {
	return fmt.Sprintf(`{"channel":"%s", "data": %s, "providerId":"%s"}`, s.Channel, s.Data, s.ProviderID)
}
