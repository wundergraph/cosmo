package nats

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
)

type LazyClient struct {
	once   sync.Once
	url    string
	opts   []nats.Option
	client *nats.Conn
	js     jetstream.JetStream
	err    error
}

func (c *LazyClient) Connect(opts ...nats.Option) error {
	c.once.Do(func() {
		c.client, c.err = nats.Connect(c.url, opts...)
		if c.err != nil {
			return
		}
		c.js, c.err = jetstream.New(c.client)
	})
	return c.err
}

func (c *LazyClient) GetClient() (*nats.Conn, error) {
	if c.client == nil {
		if err := c.Connect(c.opts...); err != nil {
			return nil, err
		}
	}
	return c.client, c.err
}

func (c *LazyClient) GetJetStream() (jetstream.JetStream, error) {
	if c.js == nil {
		if err := c.Connect(c.opts...); err != nil {
			return nil, err
		}
	}
	return c.js, c.err
}

func NewLazyClient(url string, opts ...nats.Option) *LazyClient {
	return &LazyClient{
		url:  url,
		opts: opts,
	}
}

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
