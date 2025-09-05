package redis

import (
	"context"
	"fmt"
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/metric"

	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

const (
	redisPublish = "publish"
	redisReceive = "receive"
)

// Adapter defines the methods that a Redis adapter should implement
type Adapter interface {
	// Subscribe subscribes to the given events and sends updates to the updater
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	// Publish publishes the given event to the specified channel
	Publish(ctx context.Context, event PublishEventConfiguration) error
	// Startup initializes the adapter
	Startup(ctx context.Context) error
	// Shutdown gracefully shuts down the adapter
	Shutdown(ctx context.Context) error
}

func NewProviderAdapter(ctx context.Context, logger *zap.Logger, urls []string, clusterEnabled bool, opts datasource.ProviderOpts) Adapter {
	ctx, cancel := context.WithCancel(ctx)
	if logger == nil {
		logger = zap.NewNop()
	}

	var store metric.StreamMetricStore
	if opts.StreamMetricStore != nil {
		store = opts.StreamMetricStore
	} else {
		store = metric.NewNoopStreamMetricStore()
	}

	return &ProviderAdapter{
		ctx:               ctx,
		cancel:            cancel,
		logger:            logger,
		urls:              urls,
		clusterEnabled:    clusterEnabled,
		streamMetricStore: store,
	}
}

type ProviderAdapter struct {
	ctx               context.Context
	cancel            context.CancelFunc
	conn              rd.RDCloser
	logger            *zap.Logger
	closeWg           sync.WaitGroup
	urls              []string
	clusterEnabled    bool
	streamMetricStore metric.StreamMetricStore
}

func (p *ProviderAdapter) Startup(ctx context.Context) error {
	rdCloser, err := rd.NewRedisCloser(&rd.RedisCloserOptions{
		Logger:         p.logger,
		URLs:           p.urls,
		ClusterEnabled: p.clusterEnabled,
	})
	if err != nil {
		return err
	}

	p.conn = rdCloser

	return nil
}

func (p *ProviderAdapter) Shutdown(ctx context.Context) error {
	if p.conn == nil {
		return nil
	}

	// Cancel the context to stop the subscriptions
	p.cancel()

	// Wait for the subscriptions to be closed
	p.closeWg.Wait()

	// Close the connection
	return p.conn.Close()
}

func (p *ProviderAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("channels", event.Channels),
	)
	sub := p.conn.PSubscribe(ctx, event.Channels...)
	msgChan := sub.Channel()

	cleanup := func() {
		err := sub.PUnsubscribe(ctx, event.Channels...)
		if err != nil {
			log.Error(fmt.Sprintf("error unsubscribing from redis for topics %v", event.Channels), zap.Error(err))
		}
	}

	p.closeWg.Add(1)

	go func() {
		defer p.closeWg.Done()

		for {
			select {
			case msg, ok := <-msgChan:
				if !ok {
					log.Debug("subscription closed, stopping")
					return
				}
				if msg == nil {
					log.Debug("empty message received on subscription update, skipping")
					return
				}
				log.Debug("subscription update", zap.String("message_channel", msg.Channel), zap.String("data", msg.Payload))
				p.streamMetricStore.Consume(ctx, metric.StreamsEvent{
					ProviderId:          event.ProviderID,
					StreamOperationName: redisReceive,
					ProviderType:        metric.ProviderTypeRedis,
					DestinationName:     msg.Channel,
				})
				updater.Update([]byte(msg.Payload))
			case <-p.ctx.Done():
				// When the application context is done, we stop the subscription if it is not already done
				log.Debug("application context done, stopping subscription")
				cleanup()
				return
			case <-ctx.Done():
				// When the subscription context is done, we stop the subscription if it is not already done
				log.Debug("subscription context done, stopping subscription")
				cleanup()
				return
			}
		}
	}()

	return nil
}

func (p *ProviderAdapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
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
	if p.conn == nil {
		return datasource.NewError("redis connection not initialized", nil)
	}
	intCmd := p.conn.Publish(ctx, event.Channel, data)
	if intCmd.Err() != nil {
		log.Error("publish error", zap.Error(intCmd.Err()))
		p.streamMetricStore.Produce(ctx, metric.StreamsEvent{
			ProviderId:          event.ProviderID,
			StreamOperationName: redisPublish,
			ProviderType:        metric.ProviderTypeRedis,
			ErrorType:           "publish_error",
			DestinationName:     event.Channel,
		})
		return datasource.NewError(fmt.Sprintf("error publishing to Redis PubSub channel %s", event.Channel), intCmd.Err())
	}

	p.streamMetricStore.Produce(ctx, metric.StreamsEvent{
		ProviderId:          event.ProviderID,
		StreamOperationName: redisPublish,
		ProviderType:        metric.ProviderTypeRedis,
		DestinationName:     event.Channel,
	})
	return nil
}
