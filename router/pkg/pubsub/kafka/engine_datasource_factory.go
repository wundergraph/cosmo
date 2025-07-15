package kafka

import (
	"encoding/json"
	"fmt"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type EventType int

const (
	EventTypePublish EventType = iota
	EventTypeSubscribe
)

type EngineDataSourceFactory struct {
	fieldName  string
	eventType  EventType
	topics     []string
	providerId string

	KafkaAdapter Adapter
}

func (c *EngineDataSourceFactory) GetFieldName() string {
	return c.fieldName
}

func (c *EngineDataSourceFactory) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	switch c.eventType {
	case EventTypePublish:
		dataSource = &PublishDataSource{
			pubSub: c.KafkaAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%d\" for Kafka", c.eventType)
	}

	return dataSource, nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceInput(eventData []byte) (string, error) {
	if len(c.topics) != 1 {
		return "", fmt.Errorf("publish events should define one topic but received %d", len(c.topics))
	}

	evtCfg := PublishEventConfiguration{
		Provider:  c.providerId,
		Topic:     c.topics[0],
		Event:     Event{Data: eventData},
		FieldName: c.fieldName,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionDataSource{
		pubSub: c.KafkaAdapter,
	}, nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceSubscriptionInput() (string, error) {
	evtCfg := SubscriptionEventConfiguration{
		Provider:  c.providerId,
		Topics:    c.topics,
		FieldName: c.fieldName,
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

func (c *EngineDataSourceFactory) TransformEventData(extractFn datasource.ArgumentTemplateCallback) error {
	return nil
}
