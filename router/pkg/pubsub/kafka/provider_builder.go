package kafka

import (
	"context"
	"crypto/tls"
	"fmt"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	"github.com/twmb/franz-go/pkg/sasl/scram"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"
)

const providerTypeID = "kafka"

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

func (p *ProviderBuilder) BuildEngineDataSourceFactory(data *nodev1.KafkaEventConfiguration) (datasource.EngineDataSourceFactory, error) {
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
		fieldName:    data.GetEngineEventConfiguration().GetFieldName(),
		eventType:    eventType,
		topics:       data.GetTopics(),
		providerId:   providerId,
		KafkaAdapter: adapter,
	}, nil
}

func (p *ProviderBuilder) BuildProvider(provider config.KafkaEventSource) (datasource.Provider, error) {
	adapter, pubSubProvider, err := buildProvider(p.ctx, provider, p.logger)
	if err != nil {
		return nil, err
	}

	p.adapters[provider.ID] = adapter

	return pubSubProvider, nil
}

// kgoErrorLogger is a custom logger for kgo that mirrors errors to the zap logger.
type kgoErrorLogger struct {
	logger *zap.Logger
}

func (l *kgoErrorLogger) Level() kgo.LogLevel {
	return kgo.LogLevelError
}

func (l *kgoErrorLogger) Log(level kgo.LogLevel, msg string, keyvals ...any) {
	l.logger.Sugar().Errorw(msg, keyvals...)
}

func buildKafkaAuthenticationOptions(eventSource config.KafkaEventSource) ([]kgo.Opt, error) {
	opts := []kgo.Opt{}

	if eventSource.Authentication == nil {
		return opts, nil
	}

	if eventSource.Authentication.SASLPlain.IsSet() {
		opts = append(opts, kgo.SASL(plain.Auth{
			User: *eventSource.Authentication.SASLPlain.Username,
			Pass: *eventSource.Authentication.SASLPlain.Password,
		}.AsMechanism()))
	}

	if eventSource.Authentication.SASLSCRAM.IsSet() {
		var saslAuth sasl.Mechanism
		scramAuth := scram.Auth{
			User: *eventSource.Authentication.SASLSCRAM.Username,
			Pass: *eventSource.Authentication.SASLSCRAM.Password,
		}
		switch *eventSource.Authentication.SASLSCRAM.Mechanism {
		case config.KafkaSASLSCRAMMechanismSCRAM256:
			saslAuth = scramAuth.AsSha256Mechanism()
		case config.KafkaSASLSCRAMMechanismSCRAM512:
			saslAuth = scramAuth.AsSha512Mechanism()
		default:
			return nil, fmt.Errorf("unsupported SASL SCRAM mechanism: %s", *eventSource.Authentication.SASLSCRAM.Mechanism)
		}
		opts = append(opts, kgo.SASL(saslAuth))
	}

	return opts, nil
}

// buildKafkaOptions creates a list of kgo.Opt options for the given Kafka event source configuration.
// Only general options like TLS, SASL, etc. are configured here. Specific options like topics, etc. are
// configured in the KafkaPubSub implementation.
func buildKafkaOptions(eventSource config.KafkaEventSource, logger *zap.Logger) ([]kgo.Opt, error) {
	opts := []kgo.Opt{
		kgo.SeedBrokers(eventSource.Brokers...),
		// Ensure proper timeouts are set
		kgo.ProduceRequestTimeout(10 * time.Second),
		kgo.ConnIdleTimeout(60 * time.Second),
		kgo.WithLogger(&kgoErrorLogger{logger: logger}),
	}

	if eventSource.FetchMaxWait > 0 {
		opts = append(opts, kgo.FetchMaxWait(eventSource.FetchMaxWait))
	}

	if eventSource.TLS != nil && eventSource.TLS.Enabled {
		opts = append(opts,
			// Configure TLS. Uses SystemCertPool for RootCAs by default.
			kgo.DialTLSConfig(new(tls.Config)),
		)
	}

	authOpts, err := buildKafkaAuthenticationOptions(eventSource)
	if err != nil {
		return opts, fmt.Errorf("failed to build authentication options for Kafka provider with ID \"%s\": %w", eventSource.ID, err)
	}
	if len(authOpts) > 1 {
		return opts, fmt.Errorf("multiple authentication methods specified for Kafka provider with ID \"%s\"", eventSource.ID)
	}

	opts = append(opts, authOpts...)

	return opts, nil
}

func buildProvider(ctx context.Context, provider config.KafkaEventSource, logger *zap.Logger) (Adapter, datasource.Provider, error) {
	options, err := buildKafkaOptions(provider, logger)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
	}
	adapter, err := NewProviderAdapter(ctx, logger, options)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create adapter for Kafka provider with ID \"%s\": %w", provider.ID, err)
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
