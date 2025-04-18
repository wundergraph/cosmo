package nats

import (
	"encoding/json"
	"fmt"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource struct {
	EventConfiguration *nodev1.NatsEventConfiguration
	NatsAdapter        AdapterInterface
}

func (c *PubSubDataSource) GetEngineEventConfiguration() *nodev1.EngineEventConfiguration {
	return c.EventConfiguration.GetEngineEventConfiguration()
}

func (c *PubSubDataSource) GetResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource

	typeName := c.EventConfiguration.GetEngineEventConfiguration().GetType()
	switch typeName {
	case nodev1.EventType_PUBLISH:
		dataSource = &NatsPublishDataSource{
			pubSub: c.NatsAdapter,
		}
	case nodev1.EventType_REQUEST:
		dataSource = &NatsRequestDataSource{
			pubSub: c.NatsAdapter,
		}
	default:
		return nil, fmt.Errorf("failed to configure fetch: invalid event type \"%s\" for Nats", typeName.String())
	}

	return dataSource, nil
}

func (c *PubSubDataSource) GetResolveDataSourceInput(event []byte) (string, error) {
	subjects := c.EventConfiguration.GetSubjects()

	if len(subjects) != 1 {
		return "", fmt.Errorf("publish and request events should define one subject but received %d", len(subjects))
	}

	subject := subjects[0]

	providerId := c.GetProviderId()

	evtCfg := PublishEventConfiguration{
		ProviderID: providerId,
		Subject:    subject,
		Data:       event,
	}

	return evtCfg.MarshalJSONTemplate(), nil
}

func (c *PubSubDataSource) GetResolveDataSourceSubscription() (resolve.SubscriptionDataSource, error) {
	return &SubscriptionSource{
		pubSub: c.NatsAdapter,
	}, nil
}

func (c *PubSubDataSource) GetResolveDataSourceSubscriptionInput() (string, error) {
	providerId := c.GetProviderId()

	evtCfg := SubscriptionEventConfiguration{
		ProviderID: providerId,
		Subjects:   c.EventConfiguration.GetSubjects(),
	}
	if c.EventConfiguration.StreamConfiguration != nil {
		evtCfg.StreamConfiguration = &StreamConfiguration{
			Consumer:                  c.EventConfiguration.StreamConfiguration.ConsumerName,
			StreamName:                c.EventConfiguration.StreamConfiguration.StreamName,
			ConsumerInactiveThreshold: c.EventConfiguration.StreamConfiguration.ConsumerInactiveThreshold,
		}
	}
	object, err := json.Marshal(evtCfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal event subscription streamConfiguration")
	}
	return string(object), nil
}

func (c *PubSubDataSource) GetProviderId() string {
	return c.EventConfiguration.GetEngineEventConfiguration().GetProviderId()
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
