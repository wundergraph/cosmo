package sqs

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
	queueUrls  []string
	providerId string

	SqsAdapter Adapter
}

func (c *EngineDataSourceFactory) GetFieldName() string {
	return c.fieldName
}

func (c *EngineDataSourceFactory) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	switch c.eventType {
	case EventTypePublish:
		dataSource = &PublishDataSource{
			pubSub: c.SqsAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%d\" for SQS", c.eventType)
	}

	return dataSource, nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceInput(eventData []byte) (string, error) {
	if len(c.queueUrls) != 1 {
		return "", fmt.Errorf("publish events should define one queue but received %d", len(c.queueUrls))
	}

	evtCfg := PublishEventConfiguration{
		ProviderID: c.providerId,
		QueueURL:   c.queueUrls[0],
		Data:       eventData,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionDataSource{
		pubSub: c.SqsAdapter,
	}, nil
}

func (c *EngineDataSourceFactory) ResolveDataSourceSubscriptionInput() (string, error) {
	evtCfg := SubscriptionEventConfiguration{
		ProviderID: c.providerId,
		QueueURLs:  c.queueUrls,
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
