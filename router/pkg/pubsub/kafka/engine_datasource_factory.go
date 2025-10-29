package kafka

import (
	"encoding/json"
	"fmt"

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

type EngineDataSourceFactory struct {
	fieldName  string
	eventType  EventType
	topics     []string
	providerId string
	logger     *zap.Logger

	KafkaAdapter datasource.Adapter
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

	evtCfg := publishData{
		Provider:  c.providerId,
		Topic:     c.topics[0],
		Event:     MutableEvent{Data: eventData},
		FieldName: c.fieldName,
	}

	return evtCfg.MarshalJSONTemplate()
}

func (c *EngineDataSourceFactory) ResolveDataSourceSubscription() (datasource.SubscriptionDataSource, error) {
	return datasource.NewPubSubSubscriptionDataSource[*SubscriptionEventConfiguration](
		c.KafkaAdapter,
		func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
			val, _, _, err := jsonparser.Get(input, "topics")
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
		}, c.logger), nil
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
