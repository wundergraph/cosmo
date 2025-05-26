package core

import (
	nodev1 "github.com/wundergraph/cosmo/router/gen/proto/wg/cosmo/node/v1"
)

func (r *Router) trackExecutionConfigUsage(cfg *nodev1.RouterConfig, static bool) {
	usage := make(map[string]any)

	usage["version"] = cfg.Version
	usage["compatibility_version"] = cfg.CompatibilityVersion
	usage["static_execution_config"] = static

	type DataSource struct {
		Kind       string `json:"kind"`
		RootNodes  int    `json:"root_nodes"`
		ChildNodes int    `json:"child_nodes"`
		Directives int    `json:"directives,omitempty"`
		EdfsKafka  bool   `json:"edfs_kafka,omitempty"`
		EdfsNats   bool   `json:"edfs_nats,omitempty"`

		UsesFederation                 bool `json:"uses_federation"`
		UsesFederationKeys             bool `json:"uses_federation_keys,omitempty"`
		UsesFederationProvides         bool `json:"uses_federation_provides,omitempty"`
		UsesFederationRequires         bool `json:"uses_federation_requires,omitempty"`
		UsesFederationEntityInterfaces bool `json:"uses_federation_entity_interfaces,omitempty"`
		UsesFederationInterfaceObjects bool `json:"uses_federation_interface_objects,omitempty"`

		UsesGrpc      bool   `json:"uses_grpc,omitempty"`
		UsesPlugin    bool   `json:"uses_plugin,omitempty"`
		PluginName    string `json:"plugin_name,omitempty"`
		PluginVersion string `json:"plugin_version,omitempty"`
	}

	dataSources := make([]DataSource, len(cfg.EngineConfig.DatasourceConfigurations))

	for i, ds := range cfg.EngineConfig.DatasourceConfigurations {
		dataSources[i].RootNodes = len(ds.RootNodes)
		dataSources[i].ChildNodes = len(ds.ChildNodes)
		dataSources[i].Directives = len(ds.Directives)
		switch ds.Kind {
		case nodev1.DataSourceKind_GRAPHQL:
			dataSources[i].Kind = "graphql"
			if ds.CustomGraphql != nil {
				if ds.CustomGraphql.Federation != nil {
					dataSources[i].UsesFederation = ds.CustomGraphql.Federation.Enabled
					dataSources[i].UsesFederationKeys = len(ds.Keys) > 0
					dataSources[i].UsesFederationProvides = len(ds.Provides) > 0
					dataSources[i].UsesFederationRequires = len(ds.Requires) > 0
					dataSources[i].UsesFederationEntityInterfaces = len(ds.EntityInterfaces) > 0
					dataSources[i].UsesFederationInterfaceObjects = len(ds.InterfaceObjects) > 0
				}
				if ds.CustomGraphql.Grpc != nil {
					dataSources[i].UsesGrpc = true
					if ds.CustomGraphql.Grpc.Plugin != nil {
						dataSources[i].UsesPlugin = true
						dataSources[i].PluginName = ds.CustomGraphql.Grpc.Plugin.Name
						dataSources[i].PluginVersion = ds.CustomGraphql.Grpc.Plugin.Version
					}
				}
			}
		case nodev1.DataSourceKind_PUBSUB:
			dataSources[i].Kind = "pubsub"
			if ds.CustomEvents != nil {
				if len(ds.CustomEvents.Nats) > 0 {
					dataSources[i].EdfsNats = true
				}
				if len(ds.CustomEvents.Kafka) > 0 {
					dataSources[i].EdfsKafka = true
				}
			}
		case nodev1.DataSourceKind_STATIC:
			dataSources[i].Kind = "static"
		}
	}

	usage["data_sources"] = dataSources
	usage["data_sources_total"] = len(dataSources)

	usage["subgraphs_total"] = len(cfg.Subgraphs)
	if cfg.FeatureFlagConfigs != nil && cfg.FeatureFlagConfigs.ConfigByFeatureFlagName != nil {
		usage["feature_flags_total"] = len(cfg.FeatureFlagConfigs.ConfigByFeatureFlagName)
	}

	r.usage.TrackExecutionConfigUsage(usage)
}
