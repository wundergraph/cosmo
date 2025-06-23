package sqs

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	cosmoconfig "github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "sqs"

type ProviderBuilder struct {
	ctx              context.Context
	logger           *zap.Logger
	hostName         string
	routerListenAddr string
	adapters         map[string]Adapter
}

func (p *ProviderBuilder) TypeID() string {
	return providerTypeID
}

func (p *ProviderBuilder) BuildEngineDataSourceFactory(data *nodev1.SqsEventConfiguration) (datasource.EngineDataSourceFactory, error) {
	providerId := data.GetEngineEventConfiguration().GetProviderId()
	adapter, ok := p.adapters[providerId]
	if !ok {
		return nil, fmt.Errorf("failed to get adapter for provider %s with ID %s", p.TypeID(), providerId)
	}

	var eventType EventType
	switch data.GetEngineEventConfiguration().GetType() {
	case nodev1.EventType_PUBLISH:
		eventType = EventTypePublish
	case nodev1.EventType_SUBSCRIBE:
		eventType = EventTypeSubscribe
	default:
		return nil, fmt.Errorf("unsupported event type: %s", data.GetEngineEventConfiguration().GetType())
	}

	return &EngineDataSourceFactory{
		fieldName:  data.GetEngineEventConfiguration().GetFieldName(),
		eventType:  eventType,
		queueUrls:  data.GetQueueUrls(),
		providerId: providerId,
		SqsAdapter: adapter,
	}, nil
}

func (p *ProviderBuilder) BuildProvider(provider cosmoconfig.SqsEventSource) (datasource.Provider, error) {
	adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger)
	if err != nil {
		return nil, err
	}

	p.adapters[provider.ID] = adapter

	return pubSubProvider, nil
}

// buildSqsClient creates an SQS client with the provided configuration
func buildSqsConfig(ctx context.Context, eventSource cosmoconfig.SqsEventSource) (*aws.Config, []func(*sqs.Options), error) {
	var awsConfig aws.Config
	var err error

	// Start with default config
	if eventSource.Region != "" {
		awsConfig, err = config.LoadDefaultConfig(ctx, config.WithRegion(eventSource.Region))
	} else {
		awsConfig, err = config.LoadDefaultConfig(ctx)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Override credentials if provided
	if eventSource.Authentication != nil {
		if eventSource.Authentication.AccessKeyID != nil && eventSource.Authentication.SecretAccessKey != nil {
			credsProvider := credentials.NewStaticCredentialsProvider(
				*eventSource.Authentication.AccessKeyID,
				*eventSource.Authentication.SecretAccessKey,
				func() string {
					if eventSource.Authentication.SessionToken != nil {
						return *eventSource.Authentication.SessionToken
					}
					return ""
				}(),
			)
			awsConfig.Credentials = credsProvider
		}
	}

	var clientOptions []func(*sqs.Options)

	// Set custom endpoint if provided (useful for LocalStack or custom SQS endpoints)
	if eventSource.Endpoint != "" {
		clientOptions = append(clientOptions, func(o *sqs.Options) {
			o.BaseEndpoint = aws.String(eventSource.Endpoint)
		})
	}

	return &awsConfig, clientOptions, nil
}

func buildProvider(ctx context.Context, provider cosmoconfig.SqsEventSource, logger *zap.Logger) (Adapter, datasource.Provider, error) {
	awsConfig, clientOptions, err := buildSqsConfig(ctx, provider)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create SQS client for provider with ID \"%s\": %w", provider.ID, err)
	}

	adapter, err := NewProviderAdapter(ctx, logger, awsConfig, clientOptions)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for SQS provider with ID \"%s\": %w", provider.ID, err)
	}

	pubSubProvider := datasource.NewPubSubProvider(provider.ID, providerTypeID, adapter, logger)

	return adapter, pubSubProvider, nil
}

func NewProviderBuilder(
	ctx context.Context,
	logger *zap.Logger,
	hostName string,
	routerListenAddr string,
) *ProviderBuilder {
	return &ProviderBuilder{
		ctx:              ctx,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
		adapters:         make(map[string]Adapter),
	}
}
