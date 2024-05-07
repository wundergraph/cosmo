package kafka

import (
	"context"
	"errors"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"slices"
	"sync"
)

var (
	_ pubsub_datasource.KafkaConnector = (*connector)(nil)
	_ pubsub_datasource.KafkaPubSub    = (*pubsub)(nil)

	errClientClosed = errors.New("client closed")
)

type Error struct {
	Err error
}

func (e *Error) Error() string { return e.Err.Error() }

func (e *Error) Unwrap() error { return e.Err }

func newError(err error) *Error {
	return &Error{
		Err: err,
	}
}

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
	client *kgo.Client
	logger *zap.Logger
}

func NewConnector(logger *zap.Logger, client *kgo.Client) pubsub_datasource.KafkaConnector {
	return &connector{
		client: client,
		logger: logger,
	}
}

func (c *connector) New(ctx context.Context) pubsub_datasource.KafkaPubSub {
	ps := &pubsub{
		ctx:           ctx,
		logger:        c.logger.With(zap.String("pubsub", "kafka")),
		client:        c.client,
		work:          make(chan *record, 500),
		sub:           make(chan *subscription),
		subscriptions: make(map[string][]*subscription),
		mu:            sync.Mutex{},
	}

	go func() {
		err := ps.worker(ctx)
		if err != nil {
			ps.logger.Error("worker error", zap.Error(err))
			return
		}
	}()

	go func() {
		err := ps.poll(ctx)
		if err != nil {
			if !errors.Is(err, errClientClosed) {
				ps.logger.Error("consume error", zap.Error(err))
			}
			return
		}
	}()

	return ps
}

type pubsub struct {
	ctx           context.Context
	options       []kgo.Opt
	client        *kgo.Client
	logger        *zap.Logger
	subscriptions map[string][]*subscription
	work          chan *record
	sub           chan *subscription
	mu            sync.Mutex
}

func (p *pubsub) ID() string {
	return "kafka"
}

// worker is responsible for handling the subscriptions management and the record
// processing. It is intentionally to be run in a separate goroutine. Don't run it
// across multiple goroutines as it is not safe for concurrent use.
func (p *pubsub) worker(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		case rec := <-p.work:

			if sub, ok := p.subscriptions[rec.topic]; ok {
				for _, s := range sub {
					if s.context.Err() == nil {
						p.logger.Debug("subscription update", zap.String("topic", rec.topic), zap.ByteString("data", rec.data))

						s.updater.Update(rec.data)
					}
				}
			}
		case sub := <-p.sub:

			for _, subject := range sub.topics {

				p.mu.Lock()
				if _, ok := p.subscriptions[subject]; !ok {
					p.subscriptions[subject] = make([]*subscription, 0, 10)
				}
				p.subscriptions[subject] = append(p.subscriptions[subject], sub)
				p.mu.Unlock()

				context.AfterFunc(sub.context, func() {
					p.mu.Lock()
					defer p.mu.Unlock()

					for i, s := range p.subscriptions[subject] {
						if sub == s {
							p.subscriptions[subject] = slices.Delete(p.subscriptions[subject], i, i+1)
							break
						}
					}

					if len(p.subscriptions[subject]) == 0 {
						delete(p.subscriptions, subject)
					}
				})
			}

			p.logger.Debug("subscribe", zap.Strings("topics", sub.topics))
		}
	}
}

func (p *pubsub) poll(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			p.client.Close()
			return nil

		default:
			// Try to fetch max records from any subscribed topics
			// In the future, we can consume topics individually to increase parallelism
			fetches := p.client.PollRecords(ctx, 10_000)
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

				// Send the record to the worker
				// This is blocking with built-in backpressure
				p.work <- &record{
					topic: r.Topic,
					data:  r.Value,
				}
			}
		}
	}
}

// Subscribe subscribes to the given topics and updates the subscription updater.
// The engine already deduplicates subscriptions with the same topics, stream configuration, extensions, headers, etc.
func (p *pubsub) Subscribe(ctx context.Context, event pubsub_datasource.KafkaSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {

	// Add the topics to the consumer. Internally, it will update the metadata to poll
	// the new topics / partitions. This is a non-blocking call. As long as we don't deal
	// with partitions manually, the library will clean up the old topics / partitions.
	p.client.AddConsumeTopics(event.Topics...)

	s := &subscription{
		topics:  event.Topics,
		updater: updater,
		context: ctx,
	}
	p.sub <- s

	return nil
}

func (p *pubsub) Publish(ctx context.Context, event pubsub_datasource.KafkaPublishEventConfiguration) error {

	p.logger.Debug("publish", zap.String("topic", event.Topic), zap.ByteString("data", event.Data))

	var wg sync.WaitGroup
	wg.Add(1)

	var pErr error

	p.client.Produce(ctx, &kgo.Record{
		Topic: event.Topic,
		Value: event.Data,
	}, func(record *kgo.Record, err error) {
		defer wg.Done()
		if err != nil {
			pErr = err
		}
	})

	wg.Wait()

	return pErr
}
