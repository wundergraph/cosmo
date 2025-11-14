package redis

import (
	"context"
	"fmt"
	"sync"

	"github.com/wundergraph/cosmo/router/pkg/metric"

	rd "github.com/wundergraph/cosmo/router/internal/rediscloser"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const (
	redisPublish = "publish"
	redisReceive = "receive"
)

// Ensure ProviderAdapter implements ProviderSubscriptionHooks
var _ datasource.Adapter = (*ProviderAdapter)(nil)

func NewProviderAdapter(ctx context.Context, logger *zap.Logger, urls []string, clusterEnabled bool, opts datasource.ProviderOpts) datasource.Adapter {
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

func (p *ProviderAdapter) Subscribe(ctx context.Context, conf datasource.SubscriptionEventConfiguration, updater datasource.SubscriptionEventUpdater) error {
	subConf, ok := conf.(*SubscriptionEventConfiguration)
	if !ok {
		return datasource.NewError("subscription event not support by redis provider", nil)
	}

	log := p.logger.With(
		zap.String("provider_id", conf.ProviderID()),
		zap.String("method", "subscribe"),
		zap.Strings("channels", subConf.Channels),
	)
	sub := p.conn.PSubscribe(ctx, subConf.Channels...)
	msgChan := sub.Channel()

	cleanup := func() {
		err := sub.PUnsubscribe(ctx, subConf.Channels...)
		if err != nil {
			log.Error(fmt.Sprintf("error unsubscribing from redis for topics %v", subConf.Channels), zap.Error(err))
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
					ProviderId:          conf.ProviderID(),
					StreamOperationName: redisReceive,
					ProviderType:        metric.ProviderTypeRedis,
					DestinationName:     msg.Channel,
				})
				updater.Update([]datasource.StreamEvent{
					Event{evt: &MutableEvent{
						Data: []byte(msg.Payload),
					}},
				})
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

func (p *ProviderAdapter) Publish(ctx context.Context, conf datasource.PublishEventConfiguration, events []datasource.StreamEvent) error {
	pubConf, ok := conf.(*PublishEventConfiguration)
	if !ok {
		return datasource.NewError("publish event not support by redis provider", nil)
	}

	log := p.logger.With(
		zap.String("provider_id", conf.ProviderID()),
		zap.String("method", "publish"),
		zap.String("channel", pubConf.Channel),
	)

	if p.conn == nil {
		return datasource.NewError("redis connection not initialized", nil)
	}

	if len(events) == 0 {
		return nil
	}

	log.Debug("publish", zap.Int("event_count", len(events)))

	for _, streamEvent := range events {
		redisEvent, ok := streamEvent.Clone().(*MutableEvent)
		if !ok {
			return datasource.NewError("invalid event type for Redis adapter", nil)
		}

		data, dataErr := redisEvent.Data.MarshalJSON()
		if dataErr != nil {
			log.Error("error marshalling data", zap.Error(dataErr))
			return datasource.NewError("error marshalling data", dataErr)
		}

		intCmd := p.conn.Publish(ctx, pubConf.Channel, data)
		if intCmd.Err() != nil {
			log.Error("publish error", zap.Error(intCmd.Err()))
			p.streamMetricStore.Produce(ctx, metric.StreamsEvent{
				ProviderId:          pubConf.ProviderID(),
				StreamOperationName: redisPublish,
				ProviderType:        metric.ProviderTypeRedis,
				ErrorType:           "publish_error",
				DestinationName:     pubConf.Channel,
			})
			return datasource.NewError(fmt.Sprintf("error publishing to Redis PubSub channel %s", pubConf.Channel), intCmd.Err())
		}
	}

	p.streamMetricStore.Produce(ctx, metric.StreamsEvent{
		ProviderId:          pubConf.ProviderID(),
		StreamOperationName: redisPublish,
		ProviderType:        metric.ProviderTypeRedis,
		DestinationName:     pubConf.Channel,
	})
	return nil
}
