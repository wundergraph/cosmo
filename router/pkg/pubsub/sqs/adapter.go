package sqs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/resolve"
	"go.uber.org/zap"
)

var (
	errClientClosed = errors.New("client closed")
)

// Adapter defines the interface for SQS adapter operations
type Adapter interface {
	Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error
	Publish(ctx context.Context, event PublishEventConfiguration) error
	Startup(ctx context.Context) error
	Shutdown(ctx context.Context) error
}

// ProviderAdapter is an SQS pubsub implementation.
// It uses the AWS SDK for Go v2 to consume and produce messages.
// The pubsub is stateless and does not store any messages.
// It uses a single client to send messages and creates pollers per queue to consume messages.
// Each poller continuously polls the SQS queue for new messages and updates the subscriptions with the new data.
type ProviderAdapter struct {
	ctx           context.Context
	config        *aws.Config
	client        *sqs.Client
	logger        *zap.Logger
	closeWg       sync.WaitGroup
	cancel        context.CancelFunc
	clientOptions []func(*sqs.Options)
}

// queuePoller polls the SQS queue for new messages and calls the updater function.
func (p *ProviderAdapter) queuePoller(ctx context.Context, queueURL string, updater resolve.SubscriptionUpdater) error {
	for {
		select {
		case <-p.ctx.Done(): // Close the poller if the application context was canceled
			return p.ctx.Err()
		case <-ctx.Done(): // Close the poller if the subscription context was canceled
			return ctx.Err()
		default:
			// Receive messages from the queue
			result, err := p.client.ReceiveMessage(p.ctx, &sqs.ReceiveMessageInput{
				QueueUrl:            aws.String(queueURL),
				MaxNumberOfMessages: 10,
				WaitTimeSeconds:     20, // Long polling for better efficiency
				VisibilityTimeout:   30, // Keep messages invisible for 30 seconds while processing
			})

			if err != nil {
				p.logger.Error("failed to receive messages from SQS", zap.Error(err), zap.String("queue_url", queueURL))
				// Add a small delay before retrying to avoid aggressive polling on errors
				time.Sleep(5 * time.Second)
				continue
			}

			// Process received messages
			for _, message := range result.Messages {
				if message.Body != nil {
					p.logger.Debug("subscription update", zap.String("queue_url", queueURL), zap.String("data", *message.Body))
					updater.Update([]byte(*message.Body))

					// Delete the message after processing
					_, deleteErr := p.client.DeleteMessage(p.ctx, &sqs.DeleteMessageInput{
						QueueUrl:      aws.String(queueURL),
						ReceiptHandle: message.ReceiptHandle,
					})
					if deleteErr != nil {
						p.logger.Error("failed to delete message from SQS", zap.Error(deleteErr), zap.String("queue_url", queueURL))
					}
				}
			}
		}
	}
}

// Subscribe subscribes to the given queues and updates the subscription updater.
// The engine already deduplicates subscriptions with the same queues, extensions, headers, etc.
func (p *ProviderAdapter) Subscribe(ctx context.Context, event SubscriptionEventConfiguration, updater resolve.SubscriptionUpdater) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "subscribe"),
		zap.Strings("queue_urls", event.QueueURLs),
	)

	// Start pollers for each queue
	for _, queueURL := range event.QueueURLs {
		p.closeWg.Add(1)

		go func(qURL string) {
			defer p.closeWg.Done()

			err := p.queuePoller(ctx, qURL, updater)
			if err != nil {
				if errors.Is(err, errClientClosed) || errors.Is(err, context.Canceled) {
					log.Debug("poller canceled", zap.Error(err))
				} else {
					log.Error("poller error", zap.Error(err))
				}
			}
		}(queueURL)
	}

	return nil
}

// Publish publishes the given event to the SQS queue.
// Publish errors are logged and returned as a pubsub error.
func (p *ProviderAdapter) Publish(ctx context.Context, event PublishEventConfiguration) error {
	log := p.logger.With(
		zap.String("provider_id", event.ProviderID),
		zap.String("method", "publish"),
		zap.String("queue_url", event.QueueURL),
	)

	log.Debug("publish", zap.ByteString("data", event.Data))

	// Convert data to string for SQS message body
	messageBody := string(event.Data)

	_, err := p.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(event.QueueURL),
		MessageBody: aws.String(messageBody),
	})

	if err != nil {
		log.Error("publish error", zap.Error(err))
		return datasource.NewError(fmt.Sprintf("error publishing to SQS queue %s", event.QueueURL), err)
	}

	return nil
}

func (p *ProviderAdapter) Startup(ctx context.Context) error {
	p.client = sqs.NewFromConfig(*p.config, p.clientOptions...)
	return nil
}

func (p *ProviderAdapter) Shutdown(ctx context.Context) error {
	p.cancel()
	p.closeWg.Wait()
	return nil
}

func NewProviderAdapter(ctx context.Context, logger *zap.Logger, awsConfig *aws.Config, clientOptions []func(*sqs.Options)) (*ProviderAdapter, error) {
	ctx, cancel := context.WithCancel(ctx)

	return &ProviderAdapter{
		ctx:           ctx,
		config:        awsConfig,
		logger:        logger,
		cancel:        cancel,
		clientOptions: clientOptions,
	}, nil
}
