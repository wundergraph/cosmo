package redis

import (
	"context"
	"fmt"
	"sync"

	rd "github.com/wundergraph/cosmo/router/internal/persistedoperation/operationstorage/redis"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

var (
	_ pubsub_datasource.RedisConnector = (*connector)(nil)
	_ pubsub_datasource.Redis          = (*redisPubSub)(nil)
	_ pubsub.Lifecycle                 = (*redisPubSub)(nil)
)

type connector struct {
	conn   rd.RDCloser
	logger *zap.Logger
}

func New(logger *zap.Logger, conn rd.RDCloser) pubsub_datasource.RedisConnector {
	return &connector{
		conn:   conn,
		logger: logger,
	}
}

func (c *connector) New(ctx context.Context) pubsub_datasource.Redis {
	return &redisPubSub{
		ctx:     ctx,
		conn:    c.conn,
		logger:  c.logger.With(zap.String("pubsub", "redis")),
		closeWg: sync.WaitGroup{},
	}
}

type redisPubSub struct {
	ctx     context.Context
	conn    rd.RDCloser
	logger  *zap.Logger
	closeWg sync.WaitGroup
}

func (p *redisPubSub) Subscribe(ctx context.Context, event pubsub_datasource.RedisSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
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

func (p *redisPubSub) Publish(ctx context.Context, event pubsub_datasource.RedisPublishEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("channel", event.Channel),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	data, dataErr := event.Data.MarshalJSON()
	if dataErr != nil {
		log.Error("error marshalling data", zap.Error(dataErr))
		return pubsub.NewError("error marshalling data", dataErr)
	}
	intCmd := p.conn.Publish(ctx, event.Channel, data)
	if intCmd.Err() != nil {
		log.Error("publish error", zap.Error(intCmd.Err()))
		return pubsub.NewError(fmt.Sprintf("error publishing to Redis PubSub channel %s", event.Channel), intCmd.Err())
	}

	return nil
}

func (p *redisPubSub) Shutdown(ctx context.Context) error {

	err := p.conn.Close()
	if err != nil {
		return err
	}

	// Wait for all subscriptions to be closed
	p.closeWg.Wait()

	return nil
}
