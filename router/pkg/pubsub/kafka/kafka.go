package kafka

import (
	"context"
	"errors"
	"fmt"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"strings"
	"sync"
	"time"
)

var (
	_ pubsub_datasource.KafkaConnector = (*connector)(nil)
	_ pubsub_datasource.KafkaPubSub    = (*kafkaPubSub)(nil)
	_ pubsub.Lifecycle                 = (*kafkaPubSub)(nil)

	errClientClosed = errors.New("client closed")
)

type connector struct {
	writeClient *kgo.Client
	opts        []kgo.Opt
	logger      *zap.Logger
}

func NewConnector(logger *zap.Logger, opts []kgo.Opt) (pubsub_datasource.KafkaConnector, error) {

	writeClient, err := kgo.NewClient(append(opts,
		// For observability, we set the client ID to "router"
		kgo.ClientID("cosmo.router.producer"))...,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create write client for Kafka: %w", err)
	}

	return &connector{
		writeClient: writeClient,
		opts:        opts,
		logger:      logger,
	}, nil
}

func (c *connector) New(ctx context.Context) pubsub_datasource.KafkaPubSub {

	ctx, cancel := context.WithCancel(ctx)

	ps := &kafkaPubSub{
		ctx:         ctx,
		logger:      c.logger.With(zap.String("pubsub", "kafka")),
		opts:        c.opts,
		writeClient: c.writeClient,
		closeWg:     sync.WaitGroup{},
		cancel:      cancel,
	}

	return ps
}

// kafkaPubSub is a Kafka pubsub implementation.
// It uses the franz-go Kafka client to consume and produce messages.
// The pubsub is stateless and does not store any messages.
// It uses a single write client to produce messages and a client per topic to consume messages.
// Each client polls the Kafka topic for new records and updates the subscriptions with the new data.
type kafkaPubSub struct {
	ctx         context.Context
	opts        []kgo.Opt
	logger      *zap.Logger
	writeClient *kgo.Client
	closeWg     sync.WaitGroup
	cancel      context.CancelFunc
}

// topicPoller polls the Kafka topic for new records and calls the updateTriggers function.
func (p *kafkaPubSub) topicPoller(ctx context.Context, client *kgo.Client, updater resolve.SubscriptionUpdater) error {
	ticker := time.NewTicker(resolve.HearbeatInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			updater.Heartbeat()

		case <-p.ctx.Done(): // Close the poller if the application context was canceled
			return p.ctx.Err()

		case <-ctx.Done(): // Close the poller if the subscription context was canceled
			return ctx.Err()

		default:
			ticker.Reset(resolve.HearbeatInterval)
			// Try to fetch max records from any subscribed topics
			fetches := client.PollRecords(p.ctx, 10_000)
			if fetches.IsClientClosed() {
				return errClientClosed
			}

			if errs := fetches.Errors(); len(errs) > 0 {

				for _, fetchError := range errs {

					// If the context was canceled, the error is wrapped in a fetch error
					if errors.Is(fetchError.Err, context.Canceled) {
						return fetchError.Err
					}

					var kErr *kerr.Error
					if errors.As(fetchError.Err, &kErr) {
						if !kErr.Retriable {
							p.logger.Error("unrecoverable fetch error",
								zap.Error(fetchError.Err),
								zap.String("topic", fetchError.Topic),
							)

							// If the error is not recoverable, return it and abort the poller
							return fetchError.Err
						}
					} else {
						p.logger.Error("fetch error", zap.Error(fetchError.Err), zap.String("topic", fetchError.Topic))
					}
				}
			}

			iter := fetches.RecordIter()
			for !iter.Done() {
				r := iter.Next()

				p.logger.Debug("subscription update", zap.String("topic", r.Topic), zap.ByteString("data", r.Value))
				updater.Update(r.Value)
			}
		}
	}
}

// Subscribe subscribes to the given topics and updates the subscription updater.
// The engine already deduplicates subscriptions with the same topics, stream configuration, extensions, headers, etc.
func (p *kafkaPubSub) Subscribe(ctx context.Context, event pubsub_datasource.KafkaSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {

	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("topics", event.Topics),
	)

	log.Debug("subscribe")

	// Create a new client for the topic
	client, err := kgo.NewClient(append(p.opts,
		kgo.ConsumeTopics(event.Topics...),
		// We want to consume the events produced after the first subscription was created
		// Messages are shared among all subscriptions, therefore old events are not redelivered
		// This replicates a stateless publish-subscribe model
		kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
		// For observability, we set the client ID to "router"
		kgo.ClientID(fmt.Sprintf("cosmo.router.consumer.%s", strings.Join(event.Topics, "-"))),
	)...)
	if err != nil {
		log.Error("failed to create client", zap.Error(err))
		return err
	}

	p.closeWg.Add(1)

	go func() {

		defer p.closeWg.Done()

		err := p.topicPoller(ctx, client, updater)
		if err != nil {
			if errors.Is(err, errClientClosed) || errors.Is(err, context.Canceled) {
				log.Debug("poller canceled", zap.Error(err))
			} else {
				log.Error("poller error", zap.Error(err))

			}
			return
		}
	}()

	return nil
}

// Publish publishes the given event to the Kafka topic in a non-blocking way.
// Publish errors are logged and returned as a pubsub error.
// The event is written with a dedicated write client.
func (p *kafkaPubSub) Publish(ctx context.Context, event pubsub_datasource.KafkaPublishEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("topic", event.Topic),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	var wg sync.WaitGroup
	wg.Add(1)

	var pErr error

	p.writeClient.Produce(ctx, &kgo.Record{
		Topic: event.Topic,
		Value: event.Data,
	}, func(record *kgo.Record, err error) {
		defer wg.Done()
		if err != nil {
			pErr = err
		}
	})

	wg.Wait()

	if pErr != nil {
		log.Error("publish error", zap.Error(pErr))
		return pubsub.NewError(fmt.Sprintf("error publishing to Kafka topic %s", event.Topic), pErr)
	}

	return nil
}

func (p *kafkaPubSub) Shutdown(ctx context.Context) error {

	err := p.writeClient.Flush(ctx)
	if err != nil {
		p.logger.Error("error flushing write client", zap.Error(err))
	}

	p.writeClient.Close()

	// Cancel the context to stop all pollers
	p.cancel()

	// Wait until all pollers are closed
	p.closeWg.Wait()

	return err
}
