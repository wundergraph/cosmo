package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	rd "github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage/redis"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

// SubscriptionEventConfiguration contains configuration for subscription events
type SubscriptionEventConfiguration struct {
	ProviderID string   `json:"providerId"`
	Channels   []string `json:"channels"`
}

// PublishAndRequestEventConfiguration contains configuration for publish events
type PublishAndRequestEventConfiguration struct {
	ProviderID string          `json:"providerId"`
	Channel    string          `json:"channel"`
	Data       json.RawMessage `json:"data"`
}

// AdapterInterface defines the methods that a Redis adapter should implement
type AdapterInterface interface {
	// Subscribe subscribes to the given events and sends updates to the updater
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	// Publish publishes the given event to the specified channel
	Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error
	// Startup initializes the adapter
	Startup(ctx context.Context) error
	// Shutdown gracefully shuts down the adapter
	Shutdown(ctx context.Context) error
}

func NewAdapter(logger *zap.Logger, urls []string) AdapterInterface {
	return &Adapter{
		logger:         logger,
		urls:           urls,
		clusterEnabled: false,
	}
}

type Adapter struct {
	ctx            context.Context
	conn           rd.RDCloser
	logger         *zap.Logger
	closeWg        sync.WaitGroup
	urls           []string
	clusterEnabled bool
}

func (p *Adapter) Startup(ctx context.Context) error {
	rdCloser, err := rd.NewRedisCloser(&rd.RedisCloserOptions{
		Logger:         p.logger,
		URLs:           p.urls,
		ClusterEnabled: p.clusterEnabled,
	})
	if err != nil {
		return err
	}

	p.conn = rdCloser
	p.ctx = ctx

	return nil
}

func (p *Adapter) Shutdown(ctx context.Context) error {
	return p.conn.Close()
}

func (p *Adapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("channels", event.Channels),
	)
	sub := p.conn.PSubscribe(p.ctx, event.Channels...)
	msgChan := sub.Channel()

	p.closeWg.Add(1)

	var err error
	go func() {
		defer p.closeWg.Done()

		for {
			select {
			case msg := <-msgChan:
				log.Debug("subscription update", zap.String("message_channel", msg.Channel), zap.String("data", msg.Payload))
				updater.Update([]byte(msg.Payload))
			case <-p.ctx.Done():
				// When the application context is done, we stop the subscriptions
				err = sub.PUnsubscribe(ctx, event.Channels...)
				if err != nil {
					log.Error(fmt.Sprintf("error unsubscribing from redis for topics %v", event.Channels), zap.Error(err))
				}
				return
			case <-ctx.Done():
				// When the subscription context is done, we stop the subscription
				err = sub.PUnsubscribe(context.Background(), event.Channels...)
				return
			}
		}
	}()

	return err
}

func (p *Adapter) Publish(ctx context.Context, event PublishAndRequestEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("channel", event.Channel),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	data, dataErr := event.Data.MarshalJSON()
	if dataErr != nil {
		log.Error("error marshalling data", zap.Error(dataErr))
		return datasource.NewError("error marshalling data", dataErr)
	}
	intCmd := p.conn.Publish(ctx, event.Channel, data)
	if intCmd.Err() != nil {
		log.Error("publish error", zap.Error(intCmd.Err()))
		return datasource.NewError(fmt.Sprintf("error publishing to Redis PubSub channel %s", event.Channel), intCmd.Err())
	}

	return nil
}
