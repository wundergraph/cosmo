package datasource

import (
	"context"
	"slices"
	"strconv"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

type DataSourceConfigurationWithMetadata struct {
	Configuration *nodev1.DataSourceConfiguration
	Metadata      *plan.DataSourceMetadata
}

// BuildProvidersAndDataSources is a generic function that builds providers and data sources for the given provider
// builder and event configurations.
func BuildProvidersAndDataSources(
	ctx context.Context,
	providerBuilder PubSubProviderBuilder,
	dsConfs []DataSourceConfigurationWithMetadata,
) ([]PubSubProvider, []plan.DataSource, error) {

	// Collect providers to initialize
	var providerIds []string
	for _, dsConf := range dsConfs {
		for _, event := range providerBuilder.EngineEventConfigurations(dsConf.Configuration) {
			providerId := event.GetEngineEventConfiguration().GetProviderId()
			if !slices.Contains(providerIds, providerId) {
				providerIds = append(providerIds, providerId)
			}
		}
	}

	// Initialize used providers
	pubSubProviders, err := providerBuilder.Providers(providerIds)
	if err != nil {
		return nil, nil, err
	}

	// Create data sources
	var outs []plan.DataSource
	for _, dsConf := range dsConfs {
		for i, event := range providerBuilder.EngineEventConfigurations(dsConf.Configuration) {
			pubSubDataSource, err := providerBuilder.DataSource(event)
			if err != nil {
				return nil, nil, err
			}
			out, err := plan.NewDataSourceConfiguration(
				dsConf.Configuration.Id+"-"+providerBuilder.TypeID()+"-"+strconv.Itoa(i),
				NewFactory(ctx, pubSubDataSource),
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

func getFilteredDataSourceMetadata[E EngineEventConfiguration](event E, dsMeta *plan.DataSourceMetadata) *plan.DataSourceMetadata {
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
