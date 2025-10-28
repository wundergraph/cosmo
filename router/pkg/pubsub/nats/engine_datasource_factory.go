package nats

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
	EventTypeRequest
	EventTypeSubscribe
)

type EngineDataSourceFactory struct {
	NatsAdapter datasource.Adapter

	fieldName  string
	eventType  EventType
	subjects   []string
	providerId string
	logger     *zap.Logger

	withStreamConfiguration   bool
	consumerName              string
	streamName                string
	consumerInactiveThreshold int32
}

func (c *EngineDataSourceFactory) GetFieldName() string {
	return c.fieldName
}

func (c *EngineDataSourceFactory) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	switch c.eventType {
	case EventTypePublish:
		dataSource = &NatsPublishDataSource{
			pubSub: c.NatsAdapter,
		}
	case EventTypeRequest:
		dataSource = &NatsRequestDataSource{
			pubSub: c.NatsAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%d\" for Nats", c.eventType)
	}

	return dataSource, nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceInput(eventData []byte) (string, error) {
	if len(c.subjects) != 1 {
		return "", fmt.Errorf("publish and request events should define one subject but received %d", len(c.subjects))
	}

	subject := c.subjects[0]

	evtCfg := publishData{
		Provider:  c.providerId,
		Subject:   subject,
		FieldName: c.fieldName,
		Event:     UnsafeEvent{Data: eventData},
	}

	return evtCfg.MarshalJSONTemplate()
}

func (c *EngineDataSourceFactory) ResolveDataSourceSubscription() (datasource.SubscriptionDataSource, error) {
	return datasource.NewPubSubSubscriptionDataSource[*SubscriptionEventConfiguration](
		c.NatsAdapter,
		func(ctx *resolve.Context, input []byte, xxh *xxhash.Digest) error {
			val, _, _, err := jsonparser.Get(input, "subjects")
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
		Subjects:  c.subjects,
		FieldName: c.fieldName,
	}
	if c.withStreamConfiguration {
		evtCfg.StreamConfiguration = &StreamConfiguration{
			Consumer:                  c.consumerName,
			StreamName:                c.streamName,
			ConsumerInactiveThreshold: c.consumerInactiveThreshold,
		}
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

func (c *EngineDataSourceFactory) TransformEventData(extractFn datasource.ArgumentTemplateCallback) error {
	switch c.eventType {
	case EventTypePublish, EventTypeRequest:
		extractedSubject, err := extractFn(c.subjects[0])
		if err != nil {
			return fmt.Errorf("unable to parse subject with id %s", c.subjects[0])
		}
		if !isValidNatsSubject(extractedSubject) {
			return fmt.Errorf("invalid subject: %s", extractedSubject)
		}
		c.subjects = []string{extractedSubject}
	case EventTypeSubscribe:
		extractedSubjects := make([]string, 0, len(c.subjects))
		for _, rawSubject := range c.subjects {
			extractedSubject, err := extractFn(rawSubject)
			if err != nil {
				return nil
			}
			if !isValidNatsSubject(extractedSubject) {
				return fmt.Errorf("invalid subject: %s", extractedSubject)
			}
			extractedSubjects = append(extractedSubjects, extractedSubject)
		}
		slices.Sort(extractedSubjects)
		c.subjects = extractedSubjects
	}

	return nil
}
