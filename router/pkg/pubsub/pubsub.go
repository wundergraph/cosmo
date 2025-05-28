package pubsub

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/wundergraph/cosmo/router/pkg/config"
	pubsub_datasource "github.com/wundergraph/cosmo/router/pkg/pubsub/datasource"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/kafka"
	"github.com/wundergraph/cosmo/router/pkg/pubsub/nats"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
	"go.uber.org/zap"
)

type ProviderNotDefinedError struct {
	ProviderID     string
	ProviderTypeID string
}

func (e *ProviderNotDefinedError) Error() string {
	return fmt.Sprintf("%s provider with ID %s is not defined", e.ProviderTypeID, e.ProviderID)
}

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
	var outs []plan.DataSource

	// Initialize Kafka providers and data sources
	kafkaBuilder := kafka.NewPubSubProviderBuilder(ctx, logger, hostName, routerListenAddr)
	kafkaProviderIds := []string{}
	for _, providerData := range config.Providers.Kafka {
		provider, err := kafkaBuilder.BuildProvider(providerData)
		if err != nil {
			return nil, nil, err
		}
		pubSubProviders = append(pubSubProviders, provider)
		kafkaProviderIds = append(kafkaProviderIds, providerData.ID)
	}
	for _, dsConf := range dsConfs {
		for _, event := range dsConf.Configuration.GetCustomEvents().GetKafka() {
			if !slices.Contains(kafkaProviderIds, event.GetEngineEventConfiguration().GetProviderId()) {
				return pubSubProviders, nil, &ProviderNotDefinedError{
					ProviderID:     event.GetEngineEventConfiguration().GetProviderId(),
					ProviderTypeID: kafkaBuilder.TypeID(),
				}
			}
		}
	}
	for _, dsConf := range dsConfs {
		for i, event := range dsConf.Configuration.GetCustomEvents().GetKafka() {
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
	}

	// Initialize NATS providers and data sources
	natsBuilder := nats.NewPubSubProviderBuilder(ctx, logger, hostName, routerListenAddr)
	natsProviderIds := []string{}
	for _, providerData := range config.Providers.Nats {
		provider, err := natsBuilder.BuildProvider(providerData)
		if err != nil {
			return nil, nil, err
		}
		pubSubProviders = append(pubSubProviders, provider)
		natsProviderIds = append(natsProviderIds, providerData.ID)
	}
	for _, dsConf := range dsConfs {
		for _, event := range dsConf.Configuration.GetCustomEvents().GetNats() {
			if !slices.Contains(natsProviderIds, event.GetEngineEventConfiguration().GetProviderId()) {
				return pubSubProviders, nil, &ProviderNotDefinedError{
					ProviderID:     event.GetEngineEventConfiguration().GetProviderId(),
					ProviderTypeID: natsBuilder.TypeID(),
				}
			}
		}
	}
	for _, dsConf := range dsConfs {
		for i, event := range dsConf.Configuration.GetCustomEvents().GetNats() {
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
