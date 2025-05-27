package nats

import (
	"context"

	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "nats"

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
	return c.Adapter.Startup(ctx)
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	return c.Adapter.Shutdown(ctx)
}
