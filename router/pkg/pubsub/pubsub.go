package pubsub

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/cosmo/router/pkg/config"
	pubsub_datasource "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/redis"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

type DataSourceConfigurationWithMetadata struct {
	Configuration *nodev1.DataSourceConfiguration
	Metadata      *plan.DataSourceMetadata
}

type GetID interface {
	GetID() string
}

type GetEngineEventConfiguration interface {
	GetEngineEventConfiguration() *nodev1.EngineEventConfiguration
}

type EngineEventConfiguration interface {
	GetTypeName() string
	GetFieldName() string
	GetProviderId() string
}

type ProviderNotDefinedError struct {
	ProviderID     string
	ProviderTypeID string
}

type dsConfAndEvents[E GetEngineEventConfiguration] struct {
	dsConf *DataSourceConfigurationWithMetadata
	events []E
}

func (e *ProviderNotDefinedError) Error() string {
	return fmt.Sprintf("%s provider with ID %s is not defined", e.ProviderTypeID, e.ProviderID)
}

// BuildProvidersAndDataSources is a generic function that builds providers and data sources for the given
// EventsConfiguration and DataSourceConfigurationWithMetadata
func BuildProvidersAndDataSources(
	ctx context.Context,
	config config.EventsConfiguration,
	logger *zap.Logger,
	dsConfs []DataSourceConfigurationWithMetadata,
	hostName string,
	routerListenAddr string,
) ([]pubsub_datasource.Provider, []plan.DataSource, error) {
	var pubSubProviders []pubsub_datasource.Provider
	var outs []plan.DataSource

	// initialize Kafka providers and data sources
	kafkaBuilder := kafka.NewProviderBuilder(ctx, logger, hostName, routerListenAddr)
	kafkaDsConfsWithEvents := []dsConfAndEvents[*nodev1.KafkaEventConfiguration]{}
	for _, dsConf := range dsConfs {
		kafkaDsConfsWithEvents = append(kafkaDsConfsWithEvents, dsConfAndEvents[*nodev1.KafkaEventConfiguration]{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetKafka(),
		})
	}
	kafkaPubSubProviders, kafkaOuts, err := build(ctx, kafkaBuilder, config.Providers.Kafka, kafkaDsConfsWithEvents)
	if err != nil {
		return nil, nil, err
	}
	pubSubProviders = append(pubSubProviders, kafkaPubSubProviders...)
	outs = append(outs, kafkaOuts...)

	// initialize NATS providers and data sources
	natsBuilder := nats.NewProviderBuilder(ctx, logger, hostName, routerListenAddr)
	natsDsConfsWithEvents := []dsConfAndEvents[*nodev1.NatsEventConfiguration]{}
	for _, dsConf := range dsConfs {
		natsDsConfsWithEvents = append(natsDsConfsWithEvents, dsConfAndEvents[*nodev1.NatsEventConfiguration]{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetNats(),
		})
	}
	natsPubSubProviders, natsOuts, err := build(ctx, natsBuilder, config.Providers.Nats, natsDsConfsWithEvents)
	if err != nil {
		return nil, nil, err
	}
	pubSubProviders = append(pubSubProviders, natsPubSubProviders...)
	outs = append(outs, natsOuts...)

	// initialize Redis providers and data sources
	redisBuilder := redis.NewProviderBuilder(ctx, logger, hostName, routerListenAddr)
	redisDsConfsWithEvents := []dsConfAndEvents[*nodev1.RedisEventConfiguration]{}
	for _, dsConf := range dsConfs {
		redisDsConfsWithEvents = append(redisDsConfsWithEvents, dsConfAndEvents[*nodev1.RedisEventConfiguration]{
			dsConf: &dsConf,
			events: dsConf.Configuration.GetCustomEvents().GetRedis(),
		})
	}
	redisPubSubProviders, redisOuts, err := build(ctx, redisBuilder, config.Providers.Redis, redisDsConfsWithEvents)
	if err != nil {
		return nil, nil, err
	}
	pubSubProviders = append(pubSubProviders, redisPubSubProviders...)
	outs = append(outs, redisOuts...)

	return pubSubProviders, outs, nil
}

func build[P GetID, E GetEngineEventConfiguration](ctx context.Context, builder pubsub_datasource.ProviderBuilder[P, E], providersData []P, dsConfs []dsConfAndEvents[E]) ([]pubsub_datasource.Provider, []plan.DataSource, error) {
	var pubSubProviders []pubsub_datasource.Provider
	var outs []plan.DataSource

	// check used providers
	usedProviderIds := []string{}
	for _, dsConf := range dsConfs {
		for _, event := range dsConf.events {
			if !slices.Contains(usedProviderIds, event.GetEngineEventConfiguration().GetProviderId()) {
				usedProviderIds = append(usedProviderIds, event.GetEngineEventConfiguration().GetProviderId())
			}
		}
	}

	// initialize providers if used
	providerIds := []string{}
	for _, providerData := range providersData {
		if !slices.Contains(usedProviderIds, providerData.GetID()) {
			continue
		}
		provider, err := builder.BuildProvider(providerData)
		if err != nil {
			return nil, nil, err
		}
		pubSubProviders = append(pubSubProviders, provider)
		providerIds = append(providerIds, provider.ID())
	}

	// check if all used providers are initialized
	for _, providerId := range usedProviderIds {
		if !slices.Contains(providerIds, providerId) {
			return pubSubProviders, nil, &ProviderNotDefinedError{
				ProviderID:     providerId,
				ProviderTypeID: builder.TypeID(),
			}
		}
	}

	// build data sources for each event
	for _, dsConf := range dsConfs {
		for i, event := range dsConf.events {
			plannerConfig := pubsub_datasource.NewPlannerConfig(builder, event)
			out, err := plan.NewDataSourceConfiguration(
				dsConf.dsConf.Configuration.Id+"-"+builder.TypeID()+"-"+strconv.Itoa(i),
				pubsub_datasource.NewPlannerFactory(ctx, plannerConfig),
				getFilteredDataSourceMetadata(event.GetEngineEventConfiguration(), dsConf.dsConf.Metadata),
				plannerConfig,
			)
			if err != nil {
				return nil, nil, err
			}
			outs = append(outs, out)
		}
	}

	return pubSubProviders, outs, nil
}

func getFilteredDataSourceMetadata[E EngineEventConfiguration](event E, dsMeta *plan.DataSourceMetadata) *plan.DataSourceMetadata {
	// find used root types and fields
	rootFields := make(map[string][]string)

	typeName := event.GetTypeName()
	fieldName := event.GetFieldName()
	if _, ok := rootFields[typeName]; !ok {
		rootFields[typeName] = []string{}
	}
	rootFields[typeName] = append(rootFields[typeName], fieldName)

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
	newDsMeta := *dsMeta
	newDsMeta.RootNodes = newRootNodes

	return &newDsMeta
}
