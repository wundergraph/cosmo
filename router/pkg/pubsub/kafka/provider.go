package kafka

import (
	"context"
	"crypto/tls"
	"fmt"
	"slices"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/sasl/plain"
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"go.uber.org/zap"

	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

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

func GetProviderDataSources(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	providers := make(map[string]AdapterInterface)
	pubSubProviders := []datasource.PubSubProvider{}
	definedProviders := make(map[string]bool)
	for _, provider := range config.Providers.Kafka {
		definedProviders[provider.ID] = true
	}
	if kafkaData := in.GetCustomEvents().GetKafka(); kafkaData != nil {
		// prepare providers and root fields
		usedProviders := make(map[string]bool)
		rootFields := make(map[string][]string)
		for _, event := range kafkaData {
			providerId := event.EngineEventConfiguration.ProviderId
			if !definedProviders[providerId] {
				return nil, nil, fmt.Errorf("failed to find Kafka provider with ID %s", providerId)
			}
			usedProviders[providerId] = true
			typeName := event.GetEngineEventConfiguration().GetTypeName()
			fieldName := event.GetEngineEventConfiguration().GetFieldName()
			if _, ok := rootFields[typeName]; !ok {
				rootFields[typeName] = []string{}
			}
			rootFields[typeName] = append(rootFields[typeName], fieldName)
		}

		// create providers only if they are used
		for _, provider := range config.Providers.Kafka {
			if !usedProviders[provider.ID] {
				continue
			}
			options, err := buildKafkaOptions(provider)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to build options for Kafka provider with ID \"%s\": %w", provider.ID, err)
			}
			adapter, err := NewAdapter(ctx, logger, options)
			if err != nil {
				return nil, nil, fmt.Errorf("failed to create adapter for Kafka provider with ID \"%s\": %w", provider.ID, err)
			}
			providers[provider.ID] = adapter
			pubSubProvider := &PubSubProvider{
				id:      provider.ID,
				Adapter: adapter,
				Logger:  logger,
			}
			pubSubProviders = append(pubSubProviders, pubSubProvider)
		}

		// create data sources
		ds := &PubSubDataSource{
			EventConfigurations: kafkaData,
			KafkaAdapters:       providers,
		}
		// filter dsMeta.RootNodes
		newRootNodes := []plan.TypeField{}
		for _, node := range dsMeta.RootNodes {
			newRootNode := plan.TypeField{
				TypeName:           node.TypeName,
				FieldNames:         []string{},
				ExternalFieldNames: node.ExternalFieldNames,
			}
			for _, fieldName := range node.FieldNames {
				if slices.Contains(rootFields[node.TypeName], fieldName) {
					newRootNode.FieldNames = append(newRootNode.FieldNames, fieldName)
				}
			}
			newRootNodes = append(newRootNodes, newRootNode)
		}
		newDsMets := *dsMeta
		newDsMets.RootNodes = newRootNodes

		out, err := plan.NewDataSourceConfiguration(
			in.Id+"-kafka",
			datasource.NewFactory(ctx, datasource.PubSubDataSource(ds)),
			&newDsMets,
			datasource.PubSubDataSource(ds),
		)
		if err != nil {
			return nil, nil, err
		}

		return pubSubProviders, []plan.DataSource{out}, nil
	}

	return nil, nil, nil
}

func GetProvider(ctx context.Context, in *nodev1.DataSourceConfiguration, dsMeta *plan.DataSourceMetadata, config config.EventsConfiguration, logger *zap.Logger, hostName string, routerListenAddr string) ([]datasource.PubSubProvider, []plan.DataSource, error) {
	return GetProviderDataSources(ctx, in, dsMeta, config, logger, hostName, routerListenAddr)
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
