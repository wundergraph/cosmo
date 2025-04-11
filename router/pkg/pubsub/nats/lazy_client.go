package nats

import (
	"sync"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
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
