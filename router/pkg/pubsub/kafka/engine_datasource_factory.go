package kafka

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
		return "", fmt.Errorf("publish event definition should define one topic but has %d", len(c.topics))
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
	triggerHashInputFn := func(input []byte, xxh *xxhash.Digest) error {
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
		if err != nil {
			return err
		}

		// Cursor-resume clients must never share a trigger with an at-most-once
		// client: a shared trigger would deliver the cursor to subscribers who
		// never asked for it, and a resuming client needs its own consumer seeked
		// to its cursor position. Both keys are optional request extensions, so a
		// missing value is tolerated rather than treated as an error.
		if cursor, err := jsonparser.GetString(input, "body", "extensions", "cursor"); err == nil {
			_, err = xxh.WriteString(cursor)
			if err != nil {
				return err
			}
		}
		if guarantee, err := jsonparser.GetString(input, "body", "extensions", "delivery-guarantee"); err == nil {
			_, err = xxh.WriteString(guarantee)
			if err != nil {
				return err
			}
		}

		return nil
	}

	eventCreateFn := func(data []byte) datasource.MutableStreamEvent {
		return &MutableEvent{Data: data}
	}

	return datasource.NewPubSubSubscriptionDataSource[*SubscriptionEventConfiguration](
		c.KafkaAdapter, triggerHashInputFn, c.logger, eventCreateFn,
	), nil
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
	switch c.eventType {
	case EventTypePublish:
		if len(c.topics) != 1 {
			return fmt.Errorf("publish event definition should define one topic but has %d", len(c.topics))
		}

		extractedTopic, err := extractFn(c.topics[0])
		if err != nil {
			return fmt.Errorf("unable to parse topic with id %s", c.topics[0])
		}
		c.topics = []string{extractedTopic}
	case EventTypeSubscribe:
		extractedTopics := make([]string, 0, len(c.topics))
		for _, rawTopic := range c.topics {
			extractedTopic, err := extractFn(rawTopic)
			if err != nil {
				return nil
			}
			extractedTopics = append(extractedTopics, extractedTopic)
		}
		slices.Sort(extractedTopics)
		c.topics = extractedTopics
	}

	return nil
}
