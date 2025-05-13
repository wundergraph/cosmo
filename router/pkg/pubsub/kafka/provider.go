package kafka

import (
	"context"
	"crypto/tls"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

const providerId = "kafka"

// buildKafkaOptions creates a list of kgo.Opt options for the given Kafka event source configuration.
// Only general options like TLS, SASL, etc. are configured here. Specific options like topics, etc. are
// configured in the KafkaPubSub implementation.
func buildKafkaOptions(eventSource config.KafkaEventSource) ([]kgo.Opt, error) {
	opts := []kgo.Opt{
		kgo.SeedBrokers(eventSource.Brokers...),
		// Ensure proper timeouts are set
		kgo.ProduceRequestTimeout(10 * time.Second),
		kgo.ConnIdleTimeout(60 * time.Second),
	}

	if eventSource.TLS != nil && eventSource.TLS.Enabled {
		opts = append(opts,
			// Configure TLS. Uses SystemCertPool for RootCAs by default.
			kgo.DialTLSConfig(new(tls.Config)),
		)
	}

	if eventSource.Authentication != nil && eventSource.Authentication.SASLPlain.Username != nil && eventSource.Authentication.SASLPlain.Password != nil {
		opts = append(opts, kgo.SASL(plain.Auth{
			User: *eventSource.Authentication.SASLPlain.Username,
			Pass: *eventSource.Authentication.SASLPlain.Password,
		}.AsMechanism()))
	}

	return opts, nil
}

func GetProvider(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	kafkaData := make([]datasource.EngineEventConfiguration, 0, len(in.GetCustomEvents().GetKafka()))
	for _, kafkaEvent := range in.GetCustomEvents().GetKafka() {
		kafkaData = append(kafkaData, kafkaEvent)
	}
	providerBuilder := &PubSubProviderBuilder{
		ctx:              ctx,
		config:           config,
		logger:           logger,
		hostName:         hostName,
		routerListenAddr: routerListenAddr,
	}
	return datasource.BuildProviderDataSources(providerBuilder, ctx, in, dsMeta, config, logger, hostName, routerListenAddr, kafkaData)
}

type PubSubProvider struct {
	id      string
	Logger  *zap.Logger
	Adapter AdapterInterface
}

func (c *PubSubProvider) Id() string {
	return c.id
}

func (c *PubSubProvider) Startup(ctx context.Context) error {
	if err := c.Adapter.Startup(ctx); err != nil {
		return err
	}
	return nil
}

func (c *PubSubProvider) Shutdown(ctx context.Context) error {
	if err := c.Adapter.Shutdown(ctx); err != nil {
		return err
	}
	return nil
}
