package nats

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/cespare/xxhash/v2"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

type Adapter struct {
	ctx              context.Context
	client           *LazyClient
	logger           *zap.Logger
	closeWg          sync.WaitGroup
	hostName         string
	routerListenAddr string
}

// getInstanceIdentifier returns an identifier for the current instance.
// We use the hostname and the address the router is listening on, which should provide a good representation
// of what a unique instance is from the perspective of the client that has started a subscription to this instance
// and want to restart the subscription after a failure on the client or router side.
func (p *Adapter) getInstanceIdentifier() string {
	return fmt.Sprintf("%s-%s", p.hostName, p.routerListenAddr)
}

// getDurableConsumerName returns the durable consumer name based on the given subjects and the instance id
// we need to make sure that the durable consumer name is unique for each instance and subjects to prevent
// multiple routers from changing the same consumer, which would lead to message loss and wrong messages delivered
// to the subscribers
func (p *Adapter) getDurableConsumerName(durableName string, subjects []string) (string, error) {
	subjHash := xxhash.New()
	_, err := subjHash.WriteString(p.getInstanceIdentifier())
	if err != nil {
		return "", err
	}
	for _, subject := range subjects {
		_, err = subjHash.WriteString(subject)
		if err != nil {
			return "", err
		}
	}

	return fmt.Sprintf("%s-%x", durableName, subjHash.Sum64()), nil
}

func (p *Adapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("subjects", event.Subjects),
	)

	if event.StreamConfiguration != nil {
		durableConsumerName, err := p.getDurableConsumerName(event.StreamConfiguration.Consumer, event.Subjects)
		if err != nil {
			return err
		}
		consumerConfig := jetstream.ConsumerConfig{
			Durable:        durableConsumerName,
			FilterSubjects: event.Subjects,
		}
		// Durable consumers are removed automatically only if the InactiveThreshold value is set
		if event.StreamConfiguration.ConsumerInactiveThreshold > 0 {
			consumerConfig.InactiveThreshold = time.Duration(event.StreamConfiguration.ConsumerInactiveThreshold) * time.Second
		}
		js, err := p.client.GetJetStream()
		if err != nil {
			log.Error("getting jetstream client", zap.Error(err))
			return datasource.NewError("failed to get jetstream client", err)
		}

		consumer, err := js.CreateOrUpdateConsumer(ctx, event.StreamConfiguration.StreamName, consumerConfig)
		if err != nil {
			log.Error("creating or updating consumer", zap.Error(err))
			return datasource.NewError(fmt.Sprintf(`failed to create or update consumer for stream "%s"`, event.StreamConfiguration.StreamName), err)
		}

		p.closeWg.Add(1)

		go func() {

			defer p.closeWg.Done()

			for {
				select {
				case <-p.ctx.Done():
					// When the application context is done, we stop the subscription
					return

				case <-ctx.Done():
					// When the subscription context is done, we stop the subscription
					return
				default:
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

	nc, err := p.client.GetClient()
	if err != nil {
		log.Error("getting nats client", zap.Error(err))
		return datasource.NewError("failed to get nats client", err)
	}

	msgChan := make(chan *nats.Msg)
	subscriptions := make([]*nats.Subscription, len(event.Subjects))
	for i, subject := range event.Subjects {
		subscription, err := nc.ChanSubscribe(subject, msgChan)
		if err != nil {
			log.Error("subscribing to NATS subject", zap.Error(err), zap.String("subscription_subject", subject))
			return datasource.NewError(fmt.Sprintf(`failed to subscribe to NATS subject "%s"`, subject), err)
		}
		subscriptions[i] = subscription
	}

	p.closeWg.Add(1)

	go func() {
		defer p.closeWg.Done()

		for {
			select {
			case msg := <-msgChan:
				log.Debug("subscription update", zap.String("message_subject", msg.Subject), zap.ByteString("data", msg.Data))
				updater.Update(msg.Data)
			case <-p.ctx.Done():
				// When the application context is done, we stop the subscriptions
				for _, subscription := range subscriptions {
					if err := subscription.Unsubscribe(); err != nil {
						log.Error("unsubscribing from NATS subject after application context cancellation",
							zap.Error(err), zap.String("subject", subscription.Subject),
						)
					}
				}
				return
			case <-ctx.Done():
				// When the subscription context is done, we stop the subscription
				for _, subscription := range subscriptions {
					if err := subscription.Unsubscribe(); err != nil {
						log.Error("unsubscribing from NATS subject after subscription context cancellation",
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

func (p *Adapter) Publish(_ context.Context, event PublishAndRequestEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("subject", event.Subject),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	nc, err := p.client.GetClient()
	if err != nil {
		log.Error("getting nats client", zap.Error(err))
		return datasource.NewError("failed to get nats client", err)
	}

	err = nc.Publish(event.Subject, event.Data)
	if err != nil {
		log.Error("publish error", zap.Error(err))
		return datasource.NewError(fmt.Sprintf("error publishing to NATS subject %s", event.Subject), err)
	}

	return nil
}

func (p *Adapter) Request(ctx context.Context, event PublishAndRequestEventConfiguration, w io.Writer) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "request"),
		zap.String("subject", event.Subject),
	)

	log.Debug("request", zap.ByteString("data", event.Data))

	nc, err := p.client.GetClient()
	if err != nil {
		log.Error("getting nats client", zap.Error(err))
		return datasource.NewError("failed to get nats client", err)
	}

	msg, err := nc.RequestWithContext(ctx, event.Subject, event.Data)
	if err != nil {
		log.Error("request error", zap.Error(err))
		return datasource.NewError(fmt.Sprintf("error requesting from NATS subject %s", event.Subject), err)
	}

	_, err = w.Write(msg.Data)
	if err != nil {
		log.Error("error writing response to writer", zap.Error(err))
		return err
	}

	return err
}

func (p *Adapter) flush(ctx context.Context) error {
	nc, err := p.client.GetClient()
	if err != nil {
		return err
	}
	return nc.FlushWithContext(ctx)
}

func (p *Adapter) Shutdown(ctx context.Context) error {
	nc, err := p.client.GetClient()
	if err != nil {
		return nil // Already disconnected or failed to connect
	}

	if nc.IsClosed() {
		return nil
	}

	var shutdownErr error

	fErr := p.flush(ctx)
	if fErr != nil {
		shutdownErr = errors.Join(shutdownErr, fErr)
	}

	drainErr := nc.Drain()
	if drainErr != nil {
		shutdownErr = errors.Join(shutdownErr, drainErr)
	}

	// Wait for all subscriptions to be closed
	p.closeWg.Wait()

	if shutdownErr != nil {
		return fmt.Errorf("nats pubsub shutdown: %w", shutdownErr)
	}

	return nil
}

func NewAdapter(ctx context.Context, logger *zap.Logger, url string, opts []nats.Option, hostName string, routerListenAddr string) (*Adapter, error) {
	if logger == nil {
		logger = zap.NewNop()
	}

	client := NewLazyClient(url, opts...)

	return &Adapter{
		ctx:              ctx,
		client:           client,
		logger:           logger.With(zap.String("pubsub", "nats")),
		closeWg:          sync.WaitGroup{},
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}, nil
}
