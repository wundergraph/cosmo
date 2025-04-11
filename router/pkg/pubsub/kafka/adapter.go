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

type LazyClient struct {
	once   sync.Once
	client *kgo.Client
	opts   []kgo.Opt
}

func (c *LazyClient) Connect() (err error) {
	c.once.Do(func() {
		c.client, err = kgo.NewClient(append(c.opts,
			// For observability, we set the client ID to "router"
			kgo.ClientID("cosmo.router.producer"))...,
		)
	})

	return
}

func (c *LazyClient) GetClient() *kgo.Client {
	if c.client == nil {
		c.Connect()
	}
	return c.client
}

func NewLazyClient(opts ...kgo.Opt) *LazyClient {
	return &LazyClient{
		opts: opts,
	}
}

func NewAdapter(ctx context.Context, logger *zap.Logger, opts []kgo.Opt) (AdapterInterface, error) {
	ctx, cancel := context.WithCancel(ctx)
	if logger == nil {
		logger = zap.NewNop()
	}

	client := NewLazyClient(append(opts,
		// For observability, we set the client ID to "router"
		kgo.ClientID("cosmo.router.producer"))...,
	)

	return &Adapter{
		ctx:         ctx,
		logger:      logger.With(zap.String("pubsub", "kafka")),
		opts:        opts,
		writeClient: client,
		closeWg:     sync.WaitGroup{},
		cancel:      cancel,
	}, nil
}

// AdapterInterface defines the interface for Kafka adapter operations
type AdapterInterface interface {
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	Publish(ctx context.Context, event PublishEventConfiguration) error
	Shutdown(ctx context.Context) error
}

// Adapter is a Kafka pubsub implementation.
// It uses the franz-go Kafka client to consume and produce messages.
// The pubsub is stateless and does not store any messages.
// It uses a single write client to produce messages and a client per topic to consume messages.
// Each client polls the Kafka topic for new records and updates the subscriptions with the new data.
type Adapter struct {
	ctx         context.Context
	opts        []kgo.Opt
	logger      *zap.Logger
	writeClient *LazyClient
	closeWg     sync.WaitGroup
	cancel      context.CancelFunc
}

// Ensure Adapter implements AdapterInterface
var _ AdapterInterface = (*Adapter)(nil)

// topicPoller polls the Kafka topic for new records and calls the updateTriggers function.
func (p *Adapter) topicPoller(ctx context.Context, client *kgo.Client, updater resolve.SubscriptionUpdater) error {
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
func (p *Adapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {

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
func (p *Adapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("topic", event.Topic),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	var wg sync.WaitGroup
	wg.Add(1)

	var pErr error

	p.writeClient.GetClient().Produce(ctx, &kgo.Record{
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

func (p *Adapter) Shutdown(ctx context.Context) error {

	err := p.writeClient.GetClient().Flush(ctx)
	if err != nil {
		p.logger.Error("flushing write client", zap.Error(err))
	}

	p.writeClient.GetClient().Close()

	// Cancel the context to stop all pollers
	p.cancel()

	// Wait until all pollers are closed
	p.closeWg.Wait()

	if err != nil {
		return fmt.Errorf("kafka pubsub shutdown: %w", err)
	}

	return nil
}
