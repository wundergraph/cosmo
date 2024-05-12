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
	"sync"
	"time"
)

var (
	_ pubsub_datasource.KafkaConnector = (*connector)(nil)
	_ pubsub_datasource.KafkaPubSub    = (*kafkaPubSub)(nil)
	_ pubsub.Lifecycle                 = (*kafkaPubSub)(nil)

	errClientClosed = errors.New("client closed")
)

type record struct {
	topic string
	data  []byte
}

type subscription struct {
	topics  []string
	updater resolve.SubscriptionUpdater
	context context.Context
}

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
	ps := &kafkaPubSub{
		ctx:           ctx,
		logger:        c.logger.With(zap.String("pubsub", "kafka")),
		opts:          c.opts,
		subscriptions: make(map[string][]*subscription),
		clients:       make(map[string]*kgo.Client),
		writeClient:   c.writeClient,
		mu:            sync.RWMutex{},
		closeWg:       sync.WaitGroup{},
	}

	return ps
}

// kafkaPubSub is a Kafka pubsub implementation.
// It uses the franz-go Kafka client to consume and produce messages.
// The pubsub is stateless and does not store any messages.
// It uses a single write client to produce messages and a client per topic to consume messages.
// Each client polls the Kafka topic for new records and updates the subscriptions with the new data.
type kafkaPubSub struct {
	ctx           context.Context
	opts          []kgo.Opt
	logger        *zap.Logger
	clients       map[string]*kgo.Client
	subscriptions map[string][]*subscription
	writeClient   *kgo.Client
	mu            sync.RWMutex
	closeWg       sync.WaitGroup
}

// addSubscription adds the subscription to the subscriptions map.
func (p *kafkaPubSub) addSubscription(sub *subscription) {

	p.mu.Lock()
	defer p.mu.Unlock()

	for _, topic := range sub.topics {
		if _, ok := p.subscriptions[topic]; !ok {
			p.subscriptions[topic] = make([]*subscription, 0, 10)
		}
		p.subscriptions[topic] = append(p.subscriptions[topic], sub)
	}
}

// topicPoller polls the Kafka topic for new records and calls the updateTriggers function.
func (p *kafkaPubSub) topicPoller(client *kgo.Client) error {
	p.closeWg.Add(1)
	defer p.closeWg.Done()

	for {
		select {
		// Close the client if the context was canceled
		// This is not the context of the subscription, but the context of application shutdown
		case <-p.ctx.Done():
			client.Close()
			return nil

		default:
			// Try to fetch max records from any subscribed topics
			// In the future, we could create a client per topic to fetch in parallel
			fetches := client.PollRecords(p.ctx, 10_000)
			if fetches.IsClientClosed() {
				return errClientClosed
			}

			if errs := fetches.Errors(); len(errs) > 0 {

				for _, fetchError := range errs {

					// If the context was canceled, the error is wrapped in a fetch error
					if errors.Is(fetchError.Err, context.Canceled) {
						return nil
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

				rec := &record{
					topic: r.Topic,
					data:  r.Value,
				}

				p.updateTriggers(rec)
			}
		}
	}
}

// updateTriggers updates all subscriptions that are interested in the topic with the new data.
func (p *kafkaPubSub) updateTriggers(rec *record) {
	p.mu.RLock()
	defer p.mu.RUnlock()

	// Notify all subscriptions that are interested in the topic
	if sub, ok := p.subscriptions[rec.topic]; ok {

		for _, s := range sub {
			// If the subscription is still active, update it
			if s.context.Err() == nil {
				p.logger.Debug("subscription update", zap.String("topic", rec.topic), zap.ByteString("data", rec.data))
				s.updater.Update(rec.data)
			}
		}
	}
}

// Subscribe subscribes to the given topics and updates the subscription updater.
// The engine already deduplicates subscriptions with the same topics, stream configuration, extensions, headers, etc.
func (p *kafkaPubSub) Subscribe(ctx context.Context, event pubsub_datasource.KafkaSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {

	p.logger.Debug("subscribe",
		zap.Strings("topics", event.Topics),
		zap.String("providerID", event.ProviderID),
	)

	sub := &subscription{
		topics:  event.Topics,
		updater: updater,
		context: ctx,
	}

	// Every subscription needs to be tracked individually
	p.addSubscription(sub)

	for _, t := range event.Topics {

		topic := t

		client, created, err := p.createClient(topic)
		if err != nil {
			p.logger.Error("failed to create client", zap.Error(err), zap.String("topic", topic))
			return err
		}

		// Only continue and start the poller if the client was created for the first time
		if !created {
			continue
		}

		go func() {
			err := p.topicPoller(client)
			if err != nil {
				if !errors.Is(err, errClientClosed) {
					p.logger.Error("poller error", zap.Error(err))
				}
				return
			}
		}()
	}

	go func() {

		<-sub.context.Done()

		p.logger.Debug("subscription canceled",
			zap.String("providerID", event.ProviderID),
		)

		p.removeSubscription(sub, &event)
	}()

	return nil
}

// removeSubscription removes the subscription from the topics and closes the client if there are no more subscriptions for the topic.
func (p *kafkaPubSub) removeSubscription(sub *subscription, event *pubsub_datasource.KafkaSubscriptionEventConfiguration) {

	// Remove the subscription from the topics
	for _, topic := range event.Topics {

		p.mu.RLock()
		// Zero alloc due to slice reuse
		tmp := p.subscriptions[topic][:0]
		for _, s := range p.subscriptions[topic] {
			if s != sub {
				tmp = append(tmp, s)
			}
		}
		p.mu.RUnlock()

		p.mu.Lock()
		// If there are no more subscriptions for the topic, remove the client
		// In the future, it might be better to keep the client alive for a certain amount of time
		if len(tmp) == 0 {
			delete(p.subscriptions, topic)
			if client, ok := p.clients[topic]; ok {
				client.Close()
				delete(p.clients, topic)
			}
		} else {
			p.subscriptions[topic] = tmp
		}
		p.mu.Unlock()
	}
}

// createClient creates a new client for the given topic if it does not exist yet.
// It returns true if the client was created, false otherwise.
func (p *kafkaPubSub) createClient(topic string) (*kgo.Client, bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if _, ok := p.clients[topic]; ok {
		return nil, false, nil
	}

	// Create a new client for the topic
	client, err := kgo.NewClient(append(p.opts,
		kgo.ConsumeTopics(topic),
		// We want to consume the events produced after the first subscription was created
		// Messages are shared among all subscriptions, therefore old events are not redelivered
		// This replicates a stateless publish-subscribe model
		kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
		// For observability, we set the client ID to "router"
		kgo.ClientID(fmt.Sprintf("cosmo.router.consumer.%s", topic)),
	)...)
	if err != nil {
		return nil, false, fmt.Errorf(`failed to create client for Kafka for topic "%s": %w`, topic, err)
	}

	p.clients[topic] = client

	return client, true, nil
}

// Publish publishes the given event to the Kafka topic in a non-blocking way.
// Publish errors are logged and returned as a pubsub error.
// The event is written with a dedicated write client.
func (p *kafkaPubSub) Publish(ctx context.Context, event pubsub_datasource.KafkaPublishEventConfiguration) error {

	p.logger.Debug("publish",
		zap.String("topic", event.Topic),
		zap.String("providerID", event.ProviderID),
		zap.ByteString("data", event.Data),
	)

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
		p.logger.Error("publish error",
			zap.String("topic", event.Topic),
			zap.String("providerID", event.ProviderID),
			zap.Error(pErr),
		)
		return pubsub.NewError(fmt.Sprintf("error publishing to Kafka topic %s", event.Topic), pErr)
	}

	return nil
}

func (p *kafkaPubSub) flush(ctx context.Context) error {
	err := p.writeClient.Flush(ctx)
	if err != nil {
		p.logger.Error("error flushing write client", zap.Error(err))
	}

	for _, client := range p.clients {
		if err := client.Flush(ctx); err != nil {
			p.logger.Error("error flushing client", zap.Error(err))
		}
	}

	return nil
}

func (p *kafkaPubSub) Shutdown(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	err := p.flush(ctx)
	if err != nil {
		p.logger.Error("error flushing clients", zap.Error(err))
	}

	p.writeClient.Close()

	for _, client := range p.clients {
		client.Close()
	}

	// Wait until all pollers are closed
	p.closeWg.Wait()

	return nil
}
