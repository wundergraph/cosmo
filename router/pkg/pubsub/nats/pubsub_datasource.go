package nats

import (
	"encoding/json"
	"fmt"
	"slices"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type PubSubDataSource struct {
	EventConfiguration *nodev1.NatsEventConfiguration
	NatsAdapter        AdapterInterface
}

func (c *PubSubDataSource) GetFieldName() string {
	return c.EventConfiguration.GetEngineEventConfiguration().GetFieldName()
}

func (c *PubSubDataSource) ResolveDataSource() (resolve.DataSource, error) {
	var dataSource resolve.DataSource
	eventType := c.EventConfiguration.GetEngineEventConfiguration().GetType()

	switch eventType {
	case nodev1.EventType_PUBLISH:
		dataSource = &NatsPublishDataSource{
			pubSub: c.NatsAdapter,
		}
	case nodev1.EventType_REQUEST:
		dataSource = &NatsRequestDataSource{
			pubSub: c.NatsAdapter,
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
		pubSub: c.NatsAdapter,
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

func (c *PubSubDataSource) TransformEventData(extractFn datasource.ArgumentTemplateCallback) error {
	transformedEventConfig, err := transformEventConfig(c.EventConfiguration, extractFn)
	if err != nil {
		return err
	}
	c.EventConfiguration = transformedEventConfig
	return nil
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

func transformEventConfig(cfg *nodev1.NatsEventConfiguration, fn datasource.ArgumentTemplateCallback) (*nodev1.NatsEventConfiguration, error) {
	switch v := cfg.GetEngineEventConfiguration().GetType(); v {
	case nodev1.EventType_PUBLISH, nodev1.EventType_REQUEST:
		extractedSubject, err := fn(cfg.GetSubjects()[0])
		if err != nil {
			return cfg, fmt.Errorf("unable to parse subject with id %s", cfg.GetSubjects()[0])
		}
		if !isValidNatsSubject(extractedSubject) {
			return cfg, fmt.Errorf("invalid subject: %s", extractedSubject)
		}
		cfg.Subjects = []string{extractedSubject}
	case nodev1.EventType_SUBSCRIBE:
		extractedSubjects := make([]string, 0, len(cfg.Subjects))
		for _, rawSubject := range cfg.Subjects {
			extractedSubject, err := fn(rawSubject)
			if err != nil {
				return cfg, nil
			}
			if !isValidNatsSubject(extractedSubject) {
				return cfg, fmt.Errorf("invalid subject: %s", extractedSubject)
			}
			extractedSubjects = append(extractedSubjects, extractedSubject)
		}
		slices.Sort(extractedSubjects)
		cfg.Subjects = extractedSubjects
	}
	return cfg, nil
}
