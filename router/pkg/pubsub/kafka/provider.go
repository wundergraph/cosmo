package kafka

import (
	"context"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "kafka"

type PubSubProvider struct {
	id      string
	Adapter datasource.Lifecycle
	Logger  *zap.Logger
}

func (c *PubSubProvider) ID() string {
	return c.id
}

func (c *PubSubProvider) TypeID() string {
	return providerTypeID
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	if err := c.Adapter.Startup(ctx); err != nil {
		return err
	}
	return nil
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	if err := c.Adapter.Shutdown(ctx); err != nil {
		return err
	}
	return nil
}
