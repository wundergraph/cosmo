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
		return err
	}
	if streamConfiguration != nil {
		js, err := jetstream.New(p.conn)
		if err != nil {
			return err
		}

		consumer, err := js.CreateOrUpdateConsumer(ctx, streamConfiguration.StreamName, jetstream.ConsumerConfig{
			Durable:        streamConfiguration.Consumer, // Durable consumers are not removed automatically regardless of the InactiveThreshold
			FilterSubjects: subjects,
		})
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
				msgBatch, err := consumer.FetchNoWait(1)
				if err != nil {
					return
				}
				for msg := range msgBatch.Messages() {
					err = msg.Ack()
					if err != nil {
						return
					}
					updater.Update(msg.Data())
				}
			}
		}()
		return nil
	}

	for _, subject := range subjects {
		subscription, err := p.conn.SubscribeSync(subject)
		if err != nil {
			return newEDFSNatsError(fmt.Errorf("error subscribing to NATS subject %s: %w", subject, err))
		}
		go func() {
			for {
				msg, err := subscription.NextMsgWithContext(ctx)
				if err != nil {
					_ = subscription.Unsubscribe()
					return
				}
				updater.Update(msg.Data)
			}
		}()
	}
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
