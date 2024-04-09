package pubsub

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
	_ pubsub_datasource.Connector = (*natsConnector)(nil)
	_ pubsub_datasource.PubSub    = (*natsPubSub)(nil)
)

type EDFSNatsError struct {
	Err error
}

func (e *EDFSNatsError) Error() string { return e.Err.Error() }

func (e *EDFSNatsError) Unwrap() error { return e.Err }

func newEDFSNatsError(err error) *EDFSNatsError {
	return &EDFSNatsError{
		Err: err,
	}
}

type natsConnector struct {
	conn *nats.Conn
}

func NewNATSConnector(conn *nats.Conn) pubsub_datasource.Connector {
	return &natsConnector{conn: conn}
}

func (c *natsConnector) New(ctx context.Context) pubsub_datasource.PubSub {
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
		return newEDFSNatsError(errors.New("NATS is not configured"))
	}
	return nil
}

func (p *natsPubSub) Subscribe(ctx context.Context, subjects []string, updater resolve.SubscriptionUpdater, streamConfiguration *pubsub_datasource.StreamConfiguration) error {
	if err := p.ensureConn(); err != nil {
		return newEDFSNatsError(fmt.Errorf(`failed to ensure nats connection: %w`, err))
	}
	if streamConfiguration != nil {
		js, err := jetstream.New(p.conn)
		if err != nil {
			return newEDFSNatsError(fmt.Errorf(`failed to create jetstream: %w`, err))
		}

		consumer, err := js.CreateOrUpdateConsumer(ctx, streamConfiguration.StreamName, jetstream.ConsumerConfig{
			Durable:        streamConfiguration.Consumer, // Durable consumers are not removed automatically regardless of the InactiveThreshold
			FilterSubjects: subjects,
		})
		if err != nil {
			return newEDFSNatsError(fmt.Errorf(`failed to create or update consumer "%s": %w`, streamConfiguration.Consumer, err))
		}
		if consumer == nil {
			return newEDFSNatsError(fmt.Errorf(`consumer "%s" is nil; it is likely the nats stream "%s" does not exist`, streamConfiguration.Consumer, streamConfiguration.StreamName))
		}
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				default:
				}
				msgBatch, consumerFetchErr := consumer.FetchNoWait(1)
				if consumerFetchErr != nil {
					return
				}
				for msg := range msgBatch.Messages() {
					ackErr := msg.Ack()
					if ackErr != nil {
						return
					}
					updater.Update(msg.Data())
				}
			}
		}()
		return nil
	}

	msgChan := make(chan *nats.Msg)
	subscriptions := make([]*nats.Subscription, len(subjects))
	for i, subject := range subjects {
		subscription, err := p.conn.ChanSubscribe(subject, msgChan)
		if err != nil {
			return newEDFSNatsError(fmt.Errorf(`error subscribing to NATS subject "%s": %w`, subject, err))
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

func (p *natsPubSub) Publish(_ context.Context, subject string, data []byte) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	return p.conn.Publish(subject, data)
}

func (p *natsPubSub) Request(ctx context.Context, subject string, data []byte, w io.Writer) error {
	if err := p.ensureConn(); err != nil {
		return err
	}
	msg, err := p.conn.RequestWithContext(ctx, subject, data)
	if err != nil {
		return newEDFSNatsError(fmt.Errorf("error requesting NATS subject %s: %w", subject, err))
	}
	_, err = w.Write(msg.Data)
	return err
}
