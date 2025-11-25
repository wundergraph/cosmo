package redis

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/buger/jsonparser"
	"github.com/cespare/xxhash/v2"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type EventType int

const (
	EventTypePublish EventType = iota
	EventTypeSubscribe
)

// EngineDataSourceFactory implements the datasource.EngineDataSourceFactory interface for Redis
type EngineDataSourceFactory struct {
	RedisAdapter datasource.Adapter

	fieldName  string
	eventType  EventType
	channels   []string
	providerId string
	logger     *zap.Logger
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

	evtCfg := publishData{
		Provider:  providerId,
		Channel:   channel,
		FieldName: c.fieldName,
		Event:     MutableEvent{Data: eventData},
	}

	return evtCfg.MarshalJSONTemplate()
}

// ResolveDataSourceSubscription returns the subscription data source
func (c *EngineDataSourceFactory) ResolveDataSourceSubscription() (datasource.SubscriptionDataSource, error) {
	uniqueRequestIdFn := func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
		val, _, _, err := jsonparser.Get(input, "channels")
		if err != nil {
			return err
		}

		_, err = xxh.Write(val)
		if err != nil {
			return err
		}

		val, _, _, err = jsonparser.Get(input, "providerId")
		if err != nil {
			return err
		}

		_, err = xxh.Write(val)
		return err
	}

	eventCreateFn := func(data []byte) datasource.MutableStreamEvent {
		return &MutableEvent{Data: data}
	}

	return datasource.NewPubSubSubscriptionDataSource[*SubscriptionEventConfiguration](
		c.RedisAdapter, uniqueRequestIdFn, c.logger, eventCreateFn,
	), nil
}

// ResolveDataSourceSubscriptionInput builds the input for the subscription data source
func (c *EngineDataSourceFactory) ResolveDataSourceSubscriptionInput() (string, error) {
	evtCfg := SubscriptionEventConfiguration{
		Provider:  c.providerId,
		Channels:  c.channels,
		FieldName: c.fieldName,
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
