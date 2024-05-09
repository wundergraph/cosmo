package nats

import (
	"context"
	"errors"
	"fmt"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/pubsub"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
	"io"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/datasource/pubsub_datasource"
)

var (
	_ pubsub_datasource.NatsConnector = (*connector)(nil)
	_ pubsub_datasource.NatsPubSub    = (*natsPubSub)(nil)
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
		ctx:    ctx,
		conn:   c.conn,
		js:     c.js,
		logger: c.logger.With(zap.String("pubsub", "nats")),
	}
}

type natsPubSub struct {
	ctx    context.Context
	conn   *nats.Conn
	logger *zap.Logger
	js     jetstream.JetStream
}

func (p *natsPubSub) ensureConn() error {
	if p.conn == nil {
		return pubsub.NewError("NATS is not configured", errors.New("NATS is not configured"))
	}
	return nil
}

func (p *natsPubSub) Subscribe(ctx context.Context, event pubsub_datasource.NatsSubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	p.logger.Debug("subscribe",
		zap.Strings("subjects", event.Subjects),
		zap.String("providerID", event.ProviderID),
	)

	if err := p.ensureConn(); err != nil {
		return pubsub.NewError("failed to ensure NATS connection", err)
	}

	if event.StreamConfiguration != nil {
		consumer, err := p.js.CreateOrUpdateConsumer(ctx, event.StreamConfiguration.StreamName, jetstream.ConsumerConfig{
			Durable:        event.StreamConfiguration.Consumer, // Durable consumers are not removed automatically regardless of the InactiveThreshold
			FilterSubjects: event.Subjects,
		})
		if err != nil {
			return pubsub.NewError(fmt.Sprintf(`failed to create or update consumer for stream "%s"`, event.StreamConfiguration.StreamName), err)
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
			return pubsub.NewError(fmt.Sprintf(`failed to subscribe to NATS subject "%s"`, subject), err)
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

	err := p.conn.Publish(event.Subject, event.Data)
	if err != nil {
		p.logger.Error("publish error", zap.Error(err))
		return pubsub.NewError(fmt.Sprintf("error publishing to NATS subject %s", event.Subject), err)
	}

	return nil
}

func (p *natsPubSub) Request(ctx context.Context, event pubsub_datasource.NatsPublishAndRequestEventConfiguration, w io.Writer) error {
	p.logger.Debug("request",
		zap.String("subject", event.Subject),
		zap.String("providerID", event.ProviderID),
		zap.ByteString("data", event.Data),
	)

	msg, err := p.conn.RequestWithContext(ctx, event.Subject, event.Data)
	if err != nil {
		p.logger.Error("request error", zap.Error(err))
		return pubsub.NewError(fmt.Sprintf("error requesting from NATS subject %s", event.Subject), err)
	}

	_, err = w.Write(msg.Data)

	return err
}
