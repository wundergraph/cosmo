package nats

import (
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
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
	conn *nats.Conn
}

func NewConnector(conn *nats.Conn) pubsub_datasource.NatsConnector {
	return &connector{conn: conn}
}

func (c *connector) New(ctx context.Context) pubsub_datasource.NatsPubSub {
	return &natsPubSub{
		ctx:  ctx,
		conn: c.conn,
	}
}

type natsPubSub struct {
	ctx  context.Context
	conn *nats.Conn
}

func (p *natsPubSub) ID() string {
	return "nats"
}

func (p *natsPubSub) ensureConn() error {
	if p.conn == nil {
		return newError(errors.New("NATS is not configured"))
	}
	return nil
}

func (p *natsPubSub) Subscribe(ctx context.Context, event pubsub_datasource.NatsSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
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
					msgBatch, consumerFetchErr := consumer.FetchNoWait(25)
					if consumerFetchErr != nil {
						return
					}

					for msg := range msgBatch.Messages() {
						updater.Update(msg.Data())

						// Acknowledge the message after it has been processed
						ackErr := msg.Ack()
						if ackErr != nil {
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
				updater.Update(msg.Data)
			case <-ctx.Done():
				for _, subscription := range subscriptions {
					_ = subscription.Unsubscribe()
				}
				return
			}
		}
	}()
	return nil
}

func (p *natsPubSub) Publish(_ context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	return p.conn.Publish(event.Subject, event.Data)
}

func (p *natsPubSub) Request(ctx context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration, w io.Writer) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	msg, err := p.conn.RequestWithContext(ctx, event.Subject, event.Data)
	if err != nil {
		return newError(fmt.Errorf("error requesting NATS subject %s: %w", event.Subject, err))
	}
	_, err = w.Write(msg.Data)
	return err
}
