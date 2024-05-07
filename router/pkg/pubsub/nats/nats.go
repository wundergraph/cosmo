package nats

import (
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"io"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
)

var (
	_ pubsub_datasource.NatsConnector = (*connector)(nil)
	_ pubsub_datasource.NatsPubSub    = (*natsPubSub)(nil)
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

type connector struct {
	conn   *nats.Conn
	logger *zap.Logger
}

func NewConnector(logger *zap.Logger, conn *nats.Conn) pubsub_datasource.NatsConnector {
	return &connector{
		conn:   conn,
		logger: logger,
	}
}

func (c *connector) New(ctx context.Context) pubsub_datasource.NatsPubSub {
	return &natsPubSub{
		ctx:    ctx,
		conn:   c.conn,
		logger: c.logger.With(zap.String("pubsub", "nats")),
	}
}

type natsPubSub struct {
	ctx    context.Context
	conn   *nats.Conn
	logger *zap.Logger
}

func (p *natsPubSub) ensureConn() error {
	if p.conn == nil {
		return newError(errors.New("NATS is not configured"))
	}
	return nil
}

func (p *natsPubSub) Subscribe(ctx context.Context, event pubsub_datasource.NatsSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	p.logger.Debug("subscribe",
		zap.Strings("subjects", event.Subjects),
		zap.String("providerID", event.ProviderID),
	)

	if err := p.ensureConn(); err != nil {
		return newError(fmt.Errorf(`failed to ensure nats connection: %w`, err))
	}

	if event.StreamConfiguration != nil {
		js, err := jetstream.New(p.conn)
		if err != nil {
			return newError(fmt.Errorf(`failed to create jetstream: %w`, err))
		}

		consumer, err := js.CreateOrUpdateConsumer(ctx, event.StreamConfiguration.StreamName, jetstream.ConsumerConfig{
			Durable:        event.StreamConfiguration.Consumer, // Durable consumers are not removed automatically regardless of the InactiveThreshold
			FilterSubjects: event.Subjects,
		})
		if err != nil {
			return newError(fmt.Errorf(`failed to create or update consumer "%s": %w`, event.StreamConfiguration.Consumer, err))
		}

		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				default:
					msgBatch, consumerFetchErr := consumer.FetchNoWait(100)
					if consumerFetchErr != nil {
						p.logger.Error("error fetching messages", zap.Error(consumerFetchErr))
						return
					}

					for msg := range msgBatch.Messages() {
						p.logger.Debug("subscription update", zap.String("subject", msg.Subject()), zap.ByteString("data", msg.Data()))

						updater.Update(msg.Data())

						// Acknowledge the message after it has been processed
						ackErr := msg.Ack()
						if ackErr != nil {
							p.logger.Error("error acknowledging message", zap.Error(ackErr))
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
			return newError(fmt.Errorf(`error subscribing to NATS subject "%s": %w`, subject, err))
		}
		subscriptions[i] = subscription
	}

	go func() {
		for {
			select {
			case msg := <-msgChan:
				p.logger.Debug("subscription update", zap.String("subject", msg.Subject), zap.ByteString("data", msg.Data))

				updater.Update(msg.Data)
			case <-ctx.Done():
				for _, subscription := range subscriptions {
					if err := subscription.Unsubscribe(); err != nil {
						p.logger.Error("error unsubscribing from NATS subject", zap.Error(err))
					}
				}
				return
			}
		}
	}()

	return nil
}

func (p *natsPubSub) Publish(_ context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration) error {
	p.logger.Debug("publish",
		zap.String("subject", event.Subject),
		zap.String("providerID", event.ProviderID),
		zap.ByteString("data", event.Data),
	)

	if err := p.ensureConn(); err != nil {
		p.logger.Error("error ensuring connection", zap.Error(err))
		return err
	}

	return p.conn.Publish(event.Subject, event.Data)
}

func (p *natsPubSub) Request(ctx context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration, w io.Writer) error {
	p.logger.Debug("request",
		zap.String("subject", event.Subject),
		zap.String("providerID", event.ProviderID),
		zap.ByteString("data", event.Data),
	)

	if err := p.ensureConn(); err != nil {
		p.logger.Error("error ensuring connection", zap.Error(err))
		return err
	}

	msg, err := p.conn.RequestWithContext(ctx, event.Subject, event.Data)
	if err != nil {
		return newError(fmt.Errorf("error requesting NATS subject %s: %w", event.Subject, err))
	}

	_, err = w.Write(msg.Data)

	return err
}
