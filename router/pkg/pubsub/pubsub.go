package pubsub

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/wundergraph/cosmo/router/pkg/metric"

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
	store metric.StreamMetricStore,
	logger *zap.Logger,
	dsConfs []DataSourceConfigurationWithMetadata,
	hostName string,
	routerListenAddr string,
	hooks pubsub_datasource.Hooks,
) ([]pubsub_datasource.Provider, []plan.DataSource, error) {
	if store == nil {
		store = metric.NewNoopStreamMetricStore()
	}
	if logger == nil {
		logger = zap.NewNop()
	}

	if config.SkipUnavailableProviders {
		logger.Warn("EDFS lenient mode is enabled (events.skip_unavailable_providers=true): the router will start even if an event provider referenced by the execution config is undefined or unreachable, disabling only the affected fields")
	}

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
	kafkaPubSubProviders, kafkaOuts, err := build(ctx, kafkaBuilder, config.Providers.Kafka, kafkaDsConfsWithEvents, store, hooks, logger, config.SkipUnavailableProviders)
	if err != nil {
		return nil, nil, err
	}
	for _, provider := range kafkaPubSubProviders {
		pubSubProviders = append(pubSubProviders, provider)
	}
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
	natsPubSubProviders, natsOuts, err := build(ctx, natsBuilder, config.Providers.Nats, natsDsConfsWithEvents, store, hooks, logger, config.SkipUnavailableProviders)
	if err != nil {
		return nil, nil, err
	}
	for _, provider := range natsPubSubProviders {
		pubSubProviders = append(pubSubProviders, provider)
	}
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
	redisPubSubProviders, redisOuts, err := build(ctx, redisBuilder, config.Providers.Redis, redisDsConfsWithEvents, store, hooks, logger, config.SkipUnavailableProviders)
	if err != nil {
		return nil, nil, err
	}
	for _, provider := range redisPubSubProviders {
		pubSubProviders = append(pubSubProviders, provider)
	}
	outs = append(outs, redisOuts...)

	return pubSubProviders, outs, nil
}

func build[P GetID, E GetEngineEventConfiguration](
	ctx context.Context,
	builder pubsub_datasource.ProviderBuilder[P, E],
	providersData []P, dsConfs []dsConfAndEvents[E],
	store metric.StreamMetricStore,
	hooks pubsub_datasource.Hooks,
	logger *zap.Logger,
	skipUnavailableProviders bool,
) (map[string]pubsub_datasource.Provider, []plan.DataSource, error) {
	pubSubProviders := make(map[string]pubsub_datasource.Provider)
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
	for _, providerData := range providersData {
		if !slices.Contains(usedProviderIds, providerData.GetID()) {
			continue
		}
		provider, err := builder.BuildProvider(providerData, pubsub_datasource.ProviderOpts{
			StreamMetricStore: store,
		})
		if err != nil {
			return nil, nil, err
		}
		provider.SetHooks(hooks)
		pubSubProviders[provider.ID()] = provider
	}

	// check if all used providers are initialized
	missingProviderIds := make(map[string]struct{})
	for _, providerId := range usedProviderIds {
		if _, ok := pubSubProviders[providerId]; ok {
			continue
		}
		err := &ProviderNotDefinedError{
			ProviderID:     providerId,
			ProviderTypeID: builder.TypeID(),
		}
		if !skipUnavailableProviders {
			return pubSubProviders, nil, err
		}
		// Lenient mode: do not prevent the router from starting. Log the error so it
		// surfaces in alerting, record the provider as missing, and skip the data
		// sources that depend on it. Only the affected fields become unavailable.
		logger.Error("Event provider referenced by the execution config is not defined; skipping affected data sources, the corresponding fields will be unavailable",
			zap.String("provider_id", providerId),
			zap.String("provider_type", builder.TypeID()),
		)
		missingProviderIds[providerId] = struct{}{}
	}

	// build data sources for each event
	for _, dsConf := range dsConfs {
		for i, event := range dsConf.events {
			// Skip events that reference a provider which could not be initialized
			// (only possible when skipUnavailableProviders is enabled).
			if _, ok := missingProviderIds[event.GetEngineEventConfiguration().GetProviderId()]; ok {
				continue
			}
			plannerConfig := pubsub_datasource.NewPlannerConfig(
				builder,
				event,
				pubSubProviders,
				hooks,
			)
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
