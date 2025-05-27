package pubsub

import (
	"context"
	"slices"
	"strconv"

	"github.com/wundergraph/cosmo/router/pkg/config"
	pubsub_datasource "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

// BuildProvidersAndDataSources is a generic function that builds providers and data sources for the given provider
// builder and event configurations.
func BuildProvidersAndDataSources(
	ctx context.Context,
	config config.EventsConfiguration,
	logger *zap.Logger,
	dsConfs []pubsub_datasource.DataSourceConfigurationWithMetadata,
	hostName string,
	routerListenAddr string,
) ([]pubsub_datasource.PubSubProvider, []plan.DataSource, error) {
	var pubSubProviders []pubsub_datasource.PubSubProvider

	kafkaBuilder := kafka.NewPubSubProviderBuilder(ctx, logger, hostName, routerListenAddr)
	kafkaProviderIds := []string{}
	natsBuilder := nats.NewPubSubProviderBuilder(ctx, logger, hostName, routerListenAddr)
	natsProviderIds := []string{}

	for _, event := range config.Providers.Kafka {
		provider, err := kafkaBuilder.BuildProvider(event)
		if err != nil {
			return nil, nil, err
		}
		pubSubProviders = append(pubSubProviders, provider)
		kafkaProviderIds = append(kafkaProviderIds, event.ID)
	}
	for _, event := range config.Providers.Nats {
		provider, err := natsBuilder.BuildProvider(event)
		if err != nil {
			return nil, nil, err
		}
		pubSubProviders = append(pubSubProviders, provider)
		natsProviderIds = append(natsProviderIds, event.ID)
	}

	// Create data sources
	var outs []plan.DataSource
	for _, dsConf := range dsConfs {
		for i, event := range dsConf.Configuration.GetCustomEvents().GetKafka() {
			if !slices.Contains(kafkaProviderIds, event.GetEngineEventConfiguration().GetProviderId()) {
				continue
			}
			pubSubDataSource, err := kafkaBuilder.BuildDataSource(event)
			if err != nil {
				return nil, nil, err
			}
			out, err := plan.NewDataSourceConfiguration(
				dsConf.Configuration.Id+"-"+kafkaBuilder.TypeID()+"-"+strconv.Itoa(i),
				pubsub_datasource.NewFactory(ctx, pubSubDataSource),
				getFilteredDataSourceMetadata(event, dsConf.Metadata),
				pubSubDataSource,
			)
			if err != nil {
				return nil, nil, err
			}
			outs = append(outs, out)
		}
		for i, event := range dsConf.Configuration.GetCustomEvents().GetNats() {
			if !slices.Contains(natsProviderIds, event.GetEngineEventConfiguration().GetProviderId()) {
				continue
			}
			pubSubDataSource, err := natsBuilder.BuildDataSource(event)
			if err != nil {
				return nil, nil, err
			}
			out, err := plan.NewDataSourceConfiguration(
				dsConf.Configuration.Id+"-"+natsBuilder.TypeID()+"-"+strconv.Itoa(i),
				pubsub_datasource.NewFactory(ctx, pubSubDataSource),
				getFilteredDataSourceMetadata(event, dsConf.Metadata),
				pubSubDataSource,
			)
			if err != nil {
				return nil, nil, err
			}
			outs = append(outs, out)
		}
	}

	return pubSubProviders, outs, nil
}

func getFilteredDataSourceMetadata[E pubsub_datasource.EngineEventConfiguration](event E, dsMeta *plan.DataSourceMetadata) *plan.DataSourceMetadata {
	// find used root types and fields
	rootFields := make(map[string][]string)

	typeName := event.GetEngineEventConfiguration().GetTypeName()
	fieldName := event.GetEngineEventConfiguration().GetFieldName()
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
