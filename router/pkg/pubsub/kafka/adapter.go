package kafka

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

var (
	errClientClosed = errors.New("client closed")
)

// Adapter defines the interface for Kafka adapter operations
type Adapter interface {
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	Publish(ctx context.Context, event PublishEventConfiguration) error
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

// ProviderAdapter is a Kafka pubsub implementation.
// It uses the franz-go Kafka client to consume and produce messages.
// The pubsub is stateless and does not store any messages.
// It uses a single write client to produce messages and a client per topic to consume messages.
// Each client polls the Kafka topic for new records and updates the subscriptions with the new data.
type ProviderAdapter struct {
	ctx         context.Context
	opts        []kgo.Opt
	logger      *zap.Logger
	writeClient *kgo.Client
	closeWg     sync.WaitGroup
	cancel      context.CancelFunc
}

// topicPoller polls the Kafka topic for new records and calls the updateTriggers function.
func (p *ProviderAdapter) topicPoller(ctx context.Context, client *kgo.Client, updater resolve.SubscriptionUpdater) error {
	for {
		select {
		case <-p.ctx.Done(): // Close the poller if the application context was canceled
			return p.ctx.Err()
		case <-ctx.Done(): // Close the poller if the subscription context was canceled
			return ctx.Err()

		default:
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
func (p *ProviderAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {

	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("topics", event.Topics),
	)

	// Create a new client for the topic
	client, err := kgo.NewClient(append(p.opts,
		kgo.ConsumeTopics(event.Topics...),
		// We want to consume the events produced after the first subscription was created
		// Messages are shared among all subscriptions, therefore old events are not redelivered
		// This replicates a stateless publish-subscribe model
		kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
		// For observability, we set the client ID to "router"
		kgo.ClientID(fmt.Sprintf("cosmo.router.consumer.%s", strings.Join(event.Topics, "-"))),
		// FIXME: the client id should have some unique identifier, like in nats
		// What if we have multiple subscriptions for the same topics?
		// What if we have more router instances?
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
func (p *ProviderAdapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("topic", event.Topic),
	)

	if p.writeClient == nil {
		return datasource.NewError("kafka write client not initialized", nil)
	}

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
		return datasource.NewError(fmt.Sprintf("error publishing to Kafka topic %s", event.Topic), pErr)
	}

	return nil
}

func (p *ProviderAdapter) Startup(ctx context.Context) (err error) {
	p.writeClient, err = kgo.NewClient(append(p.opts,
		// For observability, we set the client ID to "router"
		kgo.ClientID("cosmo.router.producer"))...,
	)
	if err != nil {
		return err
	}

	return
}

func (p *ProviderAdapter) Shutdown(ctx context.Context) error {

	if p.writeClient == nil {
		return nil
	}

	err := p.writeClient.Flush(ctx)
	if err != nil {
		p.logger.Error("flushing write client", zap.Error(err))
	}

	p.writeClient.Close()

	// Cancel the context to stop all pollers
	p.cancel()

	// Wait until all pollers are closed
	p.closeWg.Wait()

	if err != nil {
		return fmt.Errorf("kafka pubsub shutdown: %w", err)
	}

	return nil
}

func NewProviderAdapter(ctx context.Context, logger *zap.Logger, opts []kgo.Opt) (*ProviderAdapter, error) {
	ctx, cancel := context.WithCancel(ctx)
	if logger == nil {
		logger = zap.NewNop()
	}

	return &ProviderAdapter{
		ctx:     ctx,
		logger:  logger.With(zap.String("pubsub", "kafka")),
		opts:    opts,
		closeWg: sync.WaitGroup{},
		cancel:  cancel,
	}, nil
}
