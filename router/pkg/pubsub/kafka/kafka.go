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
	_ pubsub_datasource.KafkaPubSub    = (*kafkaPubsub)(nil)

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

	writeClient, err := kgo.NewClient(opts...)
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
	ps := &kafkaPubsub{
		ctx:           ctx,
		logger:        c.logger.With(zap.String("pubsub", "kafka")),
		opts:          c.opts,
		subscriptions: make(map[string][]*subscription),
		clients:       make(map[string]*kgo.Client),
		writeClient:   c.writeClient,
		mu:            sync.RWMutex{},
	}

	return ps
}

type kafkaPubsub struct {
	ctx           context.Context
	opts          []kgo.Opt
	logger        *zap.Logger
	clients       map[string]*kgo.Client
	subscriptions map[string][]*subscription
	writeClient   *kgo.Client
	mu            sync.RWMutex
}

func (p *kafkaPubsub) addSubscription(sub *subscription) {

	p.mu.Lock()
	defer p.mu.Unlock()

	for _, topic := range sub.topics {
		if _, ok := p.subscriptions[topic]; !ok {
			p.subscriptions[topic] = make([]*subscription, 0, 10)
		}
		p.subscriptions[topic] = append(p.subscriptions[topic], sub)
	}
}

func (p *kafkaPubsub) topicPoller(ctx context.Context, client *kgo.Client) error {
	for {
		select {
		case <-ctx.Done():
			client.Close()
			return nil

		default:
			// Try to fetch max records from any subscribed topics
			// In the future, we could create a client per topic to fetch in parallel
			fetches := client.PollRecords(ctx, 10_000)
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

func (p *kafkaPubsub) updateTriggers(rec *record) {
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
func (p *kafkaPubsub) Subscribe(ctx context.Context, event pubsub_datasource.KafkaSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {

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

		// If the topic client already exists, continue
		p.mu.Lock()

		if _, ok := p.clients[topic]; ok {
			p.mu.Unlock()
			continue
		}

		// Create a new client for the topic
		client, err := kgo.NewClient(append(p.opts,
			kgo.ConsumeTopics(topic),
			// We want to consume the events produced after the first subscription was created
			// Messages are shared among all subscriptions, therefore old events are not redelivered
			// This replicates a stateless publish-subscribe model
			kgo.ConsumeResetOffset(kgo.NewOffset().AfterMilli(time.Now().UnixMilli())),
		)...)
		if err != nil {
			p.mu.Unlock()
			return fmt.Errorf(`failed to create client for Kafka for topic "%s": %w`, topic, err)
		}

		p.clients[topic] = client

		p.mu.Unlock()

		go func() {
			err := p.topicPoller(p.ctx, client)
			if err != nil {
				if !errors.Is(err, errClientClosed) {
					p.logger.Error("consume error", zap.Error(err))
				}
				return
			}
		}()
	}

	go func() {

		<-ctx.Done()

		p.logger.Debug("subscription canceled",
			zap.String("providerID", event.ProviderID),
		)

		p.mu.Lock()
		defer p.mu.Unlock()

		// Remove the subscription from the topics
		for _, topic := range event.Topics {

			// Zero alloc due to slice reuse
			tmp := p.subscriptions[topic][:0]
			for _, s := range p.subscriptions[topic] {
				if s != sub {
					tmp = append(tmp, s)
				}
			}

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
		}
	}()

	return nil
}

func (p *kafkaPubsub) Publish(ctx context.Context, event pubsub_datasource.KafkaPublishEventConfiguration) error {

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
		)
		return pubsub.NewError(fmt.Sprintf("error publishing to Kafka topic %s", event.Topic), pErr)
	}

	return nil
}
