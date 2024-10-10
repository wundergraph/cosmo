package nats

import (
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"io"
	"sync"
	"time"
)

var (
	_ pubsub_datasource.NatsConnector = (*connector)(nil)
	_ pubsub_datasource.NatsPubSub    = (*natsPubSub)(nil)
	_ pubsub.Lifecycle                = (*natsPubSub)(nil)
)

type connector struct {
	conn   *nats.Conn
	logger *zap.Logger
	js     jetstream.JetStream
}

func NewConnector(logger *zap.Logger, conn *nats.Conn, js jetstream.JetStream) pubsub_datasource.NatsConnector {
	return &connector{
		conn:   conn,
		logger: logger,
		js:     js,
	}
}

func (c *connector) New(ctx context.Context) pubsub_datasource.NatsPubSub {
	return &natsPubSub{
		ctx:     ctx,
		conn:    c.conn,
		js:      c.js,
		logger:  c.logger.With(zap.String("pubsub", "nats")),
		closeWg: sync.WaitGroup{},
	}
}

type natsPubSub struct {
	ctx     context.Context
	conn    *nats.Conn
	logger  *zap.Logger
	js      jetstream.JetStream
	closeWg sync.WaitGroup
}

func (p *natsPubSub) Subscribe(ctx context.Context, event pubsub_datasource.NatsSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("subjects", event.Subjects),
	)

	if event.StreamConfiguration != nil {
		consumer, err := p.js.CreateOrUpdateConsumer(ctx, event.StreamConfiguration.StreamName, jetstream.ConsumerConfig{
			Durable:        event.StreamConfiguration.Consumer, // Durable consumers are not removed automatically regardless of the InactiveThreshold
			FilterSubjects: event.Subjects,
		})
		if err != nil {
			log.Error("error creating or updating consumer", zap.Error(err))
			return pubsub.NewError(fmt.Sprintf(`failed to create or update consumer for stream "%s"`, event.StreamConfiguration.StreamName), err)
		}

		p.closeWg.Add(1)

		go func() {

			defer p.closeWg.Done()

			ticker := time.NewTicker(resolve.HearbeatInterval)
			defer ticker.Stop()

			for {
				select {
				case <-p.ctx.Done():
					// When the application context is done, we stop the subscription
					return

				case <-ctx.Done():
					// When the subscription context is done, we stop the subscription
					return
				case <-ticker.C:
					updater.Heartbeat()
				default:
					ticker.Reset(resolve.HearbeatInterval)

					msgBatch, consumerFetchErr := consumer.FetchNoWait(300)
					if consumerFetchErr != nil {
						log.Error("error fetching messages", zap.Error(consumerFetchErr))
						return
					}

					for msg := range msgBatch.Messages() {
						log.Debug("subscription update", zap.String("message_subject", msg.Subject()), zap.ByteString("data", msg.Data()))

						updater.Update(msg.Data())

						// Acknowledge the message after it has been processed
						ackErr := msg.Ack()
						if ackErr != nil {
							log.Error("error acknowledging message", zap.String("message_subject", msg.Subject()), zap.Error(ackErr))
							return
						}
					}
				}

			}
		}()

		return nil
	}

	msgChan := make(chan *nats.Msg)
	subscriptions := make([]*nats.Subscription, len(event.Subjects))
	for i, subject := range event.Subjects {
		subscription, err := p.conn.ChanSubscribe(subject, msgChan)
		if err != nil {
			log.Error("error subscribing to NATS subject", zap.Error(err), zap.String("subscription_subject", subject))
			return pubsub.NewError(fmt.Sprintf(`failed to subscribe to NATS subject "%s"`, subject), err)
		}
		subscriptions[i] = subscription
	}

	p.closeWg.Add(1)

	go func() {
		defer p.closeWg.Done()

		ticker := time.NewTicker(resolve.HearbeatInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				updater.Heartbeat()
			case msg := <-msgChan:
				log.Debug("subscription update", zap.String("message_subject", msg.Subject), zap.ByteString("data", msg.Data))
				ticker.Reset(resolve.HearbeatInterval)
				updater.Update(msg.Data)
			case <-p.ctx.Done():
				// When the application context is done, we stop the subscriptions
				for _, subscription := range subscriptions {
					if err := subscription.Unsubscribe(); err != nil {
						log.Error("error unsubscribing from NATS subject after application context cancellation",
							zap.Error(err), zap.String("subject", subscription.Subject),
						)
					}
				}
				return
			case <-ctx.Done():
				// When the subscription context is done, we stop the subscription
				for _, subscription := range subscriptions {
					if err := subscription.Unsubscribe(); err != nil {
						log.Error("error unsubscribing from NATS subject after subscription context cancellation",
							zap.Error(err), zap.String("subscription_subject", subscription.Subject),
						)
					}
				}
				return
			}
		}
	}()

	return nil
}

func (p *natsPubSub) Publish(_ context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("subject", event.Subject),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	err := p.conn.Publish(event.Subject, event.Data)
	if err != nil {
		log.Error("publish error", zap.Error(err))
		return pubsub.NewError(fmt.Sprintf("error publishing to NATS subject %s", event.Subject), err)
	}

	return nil
}

func (p *natsPubSub) Request(ctx context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration, w io.Writer) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "request"),
		zap.String("subject", event.Subject),
	)

	log.Debug("request", zap.ByteString("data", event.Data))

	msg, err := p.conn.RequestWithContext(ctx, event.Subject, event.Data)
	if err != nil {
		log.Error("request error", zap.Error(err))
		return pubsub.NewError(fmt.Sprintf("error requesting from NATS subject %s", event.Subject), err)
	}

	_, err = w.Write(msg.Data)
	if err != nil {
		log.Error("error writing response to writer", zap.Error(err))
		return err
	}

	return err
}

func (p *natsPubSub) flush(ctx context.Context) error {
	return p.conn.FlushWithContext(ctx)
}

func (p *natsPubSub) Shutdown(ctx context.Context) error {

	if p.conn.IsClosed() {
		return nil
	}

	var err error

	fErr := p.flush(ctx)
	if fErr != nil {
		p.logger.Error("error flushing NATS connection", zap.Error(err))
		err = errors.Join(err, fErr)
	}

	p.conn.Close()

	// Wait for all subscriptions to be closed
	p.closeWg.Wait()

	return err
}
