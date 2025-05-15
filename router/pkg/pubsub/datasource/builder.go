package datasource

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
	"github.com/wundergraph/graphql-go-tools/v2/pkg/engine/plan"
)

// BuildProvidersAndDataSources is a generic function that builds providers and data sources for the given provider
// builder and event configurations.
func BuildProvidersAndDataSources[A any](
	providerBuilder PubSubProviderBuilder[A],
	ctx context.Context,
	in *nodev1.DataSourceConfiguration,
	dsMeta *plan.DataSourceMetadata,
	data []EngineEventConfiguration,
) ([]PubSubProvider, []plan.DataSource, error) {
	if len(data) == 0 {
		return nil, nil, nil
	}

	// Collect all used providers
	var usedProviders []string
	for _, event := range data {
		providerId := event.GetEngineEventConfiguration().GetProviderId()
		if !slices.Contains(usedProviders, providerId) {
			usedProviders = append(usedProviders, providerId)
		}
	}

	// Initialize used providers
	adapters, pubSubProviders, err := providerBuilder.Providers(usedProviders)
	if err != nil {
		return nil, nil, err
	}

	// Verify that all used providers are defined
	definedProviders := make([]string, 0, len(adapters))
	for providerID := range adapters {
		definedProviders = append(definedProviders, providerID)
	}
	for _, event := range data {
		if !slices.Contains(definedProviders, event.GetEngineEventConfiguration().GetProviderId()) {
			return nil, nil, fmt.Errorf(providerBuilder.TypeID()+" provider with ID %s is not defined", event.GetEngineEventConfiguration().GetProviderId())
		}
	}

	// Create data sources
	var outs []plan.DataSource
	for i, event := range data {
		pubsubDataSource, err := providerBuilder.DataSource(event, adapters)
		if err != nil {
			return nil, nil, err
		}
		out, err := plan.NewDataSourceConfiguration(
			in.Id+"-"+providerBuilder.TypeID()+"-"+strconv.Itoa(i),
			NewFactory(ctx, pubsubDataSource),
			getFilteredDataSourceMetadata(event, dsMeta),
			pubsubDataSource,
		)
		if err != nil {
			return nil, nil, err
		}
		outs = append(outs, out)
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
