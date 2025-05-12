package nats

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource struct {
	EventConfiguration  *nodev1.NatsEventConfiguration
	EventConfigurations []*nodev1.NatsEventConfiguration
	NatsAdapters        map[string]AdapterInterface
}

func (c *PubSubDataSource) SetCurrentField(typeName string, fieldName string, extractFn datasource.ArgumentTemplateCallback) error {
	for _, event := range c.EventConfigurations {
		if event.GetEngineEventConfiguration().GetTypeName() == typeName && event.GetEngineEventConfiguration().GetFieldName() == fieldName {
			event, err := transformEventConfig(event, extractFn)
			if err != nil {
				return err
			}
			c.EventConfiguration = event

			return nil
		}
	}

	if c.EventConfiguration == nil {
		return fmt.Errorf("failed to find event configuration for typeName: %s, fieldName: %s", typeName, fieldName)
	}

	return nil
}

func (c *PubSubDataSource) EngineEventConfiguration() *nodev1.EngineEventConfiguration {
	return c.EventConfiguration.GetEngineEventConfiguration()
}

func (c *PubSubDataSource) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource
	eventType := c.EventConfiguration.GetEngineEventConfiguration().GetType()
	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()

	switch eventType {
	case nodev1.EventType_PUBLISH:
		dataSource = &NatsPublishDataSource{
			pubSub: c.NatsAdapters[providerId],
		}
	case nodev1.EventType_REQUEST:
		dataSource = &NatsRequestDataSource{
			pubSub: c.NatsAdapters[providerId],
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Nats", eventType.String())
	}

	return dataSource, nil
}

func (c *PubSubDataSource) ResolveDataSourceInput(eventData []byte) (string, error) {
	subjects := c.EventConfiguration.GetSubjects()

	if len(subjects) != 1 {
		return "", fmt.Errorf("publish and request events should define one subject but received %d", len(subjects))
	}

	subject := subjects[0]

	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Subject:    subject,
		Data:       eventData,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *PubSubDataSource) ResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionSource{
		pubSub: c.NatsAdapters[c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()],
	}, nil
}

func (c *PubSubDataSource) ResolveDataSourceSubscriptionInput() (string, error) {
	providerId := c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()

	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Subjects:   c.EventConfiguration.GetSubjects(),
	}
	if c.EventConfiguration.GetStreamConfiguration() != nil {
		evtCfg.StreamConfiguration = &StreamConfiguration{
			Consumer:                  c.EventConfiguration.GetStreamConfiguration().GetConsumerName(),
			StreamName:                c.EventConfiguration.GetStreamConfiguration().GetStreamName(),
			ConsumerInactiveThreshold: c.EventConfiguration.GetStreamConfiguration().GetConsumerInactiveThreshold(),
		}
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

type StreamConfiguration struct {
	Consumer                  string `json:"consumer"`
	ConsumerInactiveThreshold int32  `json:"consumerInactiveThreshold"`
	StreamName                string `json:"streamName"`
}

type SubscriptionEventConfiguration struct {
	ProviderID          string               `json:"providerId"`
	Subjects            []string             `json:"subjects"`
	StreamConfiguration *StreamConfiguration `json:"streamConfiguration,omitempty"`
}

type PublishAndRequestEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishAndRequestEventConfiguration) MarshalJSONTemplate() string {
	return fmt.Sprintf(`{"subject":"%s", "data": %s, "providerId":"%s"}`, s.Subject, s.Data, s.ProviderID)
}

type PublishEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Subject    string          `json:"subject"`
	Data       json.RawMessage `json:"data"`
}

func (s *PublishEventConfiguration) MarshalJSONTemplate() string {
	return fmt.Sprintf(`{"subject":"%s", "data": %s, "providerId":"%s"}`, s.Subject, s.Data, s.ProviderID)
}
