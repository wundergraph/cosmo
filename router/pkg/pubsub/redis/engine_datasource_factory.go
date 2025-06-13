package redis

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type EventType int

const (
	EventTypePublish EventType = iota
	EventTypeSubscribe
)

// EngineDataSourceFactory implements the datasource.EngineDataSourceFactory interface for Redis
type EngineDataSourceFactory struct {
	RedisAdapter Adapter

	fieldName  string
	eventType  EventType
	channels   []string
	providerId string
}

func (c *EngineDataSourceFactory) GetFieldName() string {
	return c.fieldName
}

// ResolveDataSource returns the appropriate data source based on the event type
func (c *EngineDataSourceFactory) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	eventType := c.eventType
	switch eventType {
	case EventTypePublish:
		dataSource = &PublishDataSource{
			pubSub: c.RedisAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%d\" for Redis", eventType)
	}

	return dataSource, nil
}

// ResolveDataSourceInput builds the input for the data source
func (c *EngineDataSourceFactory) ResolveDataSourceInput(eventData []byte) (string, error) {
	channels := c.channels

	if len(channels) != 1 {
		return "", fmt.Errorf("publish events should define one channel but received %d", len(channels))
	}

	channel := channels[0]
	providerId := c.providerId

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
	evtCfg := SubscriptionEventConfiguration{
		ProviderID: c.providerId,
		Channels:   c.channels,
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription configuration")
	}
	return string(object), nil
}

// TransformEventData transforms the event data using the extract function
func (c *EngineDataSourceFactory) TransformEventData(extractFn datasource.ArgumentTemplateCallback) error {
	switch c.eventType {
	case EventTypePublish:
		extractedChannel, err := extractFn(c.channels[0])
		if err != nil {
			return fmt.Errorf("unable to parse channel with id %s", c.channels[0])
		}
		c.channels = []string{extractedChannel}
	case EventTypeSubscribe:
		extractedChannels := make([]string, 0, len(c.channels))
		for _, rawChannel := range c.channels {
			extractedChannel, err := extractFn(rawChannel)
			if err != nil {
				return nil
			}
			extractedChannels = append(extractedChannels, extractedChannel)
		}
		slices.Sort(extractedChannels)
		c.channels = extractedChannels
	}

	return nil
}
