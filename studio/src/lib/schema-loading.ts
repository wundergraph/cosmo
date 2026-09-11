/** What a schema selection is pointed at. */
export type ConfigType = 'graph' | 'featureFlag' | 'featureSubgraph' | 'subgraph';

export const CONFIG_TYPE_LABELS: Record<ConfigType, string> = {
  graph: 'Graph',
  featureFlag: 'Feature flag',
  featureSubgraph: 'Feature subgraph',
  subgraph: 'Subgraph',
};

/** Query string values are plain strings, so narrow them to a `ConfigType`. */
export const toConfigType = (value: string | undefined): ConfigType =>
  value && Object.hasOwn(CONFIG_TYPE_LABELS, value) ? (value as ConfigType) : 'graph';

export interface SchemaLoadingInput {
  isLoadingGraphSchema: boolean;
  isLoadingSubgraphSchema: boolean;
  isLoadingFeatureSubgraphSchema: boolean;
  /** True while the feature flag list, which resolves a feature subgraph selection, is in flight. */
  isLoadingCompositionFlags: boolean;
  isFeatureSubgraphSelected: boolean;
}

/**
 * Whether the selected schema is still being resolved. A feature subgraph selection is resolved
 * from the feature flag list, so which schema to fetch is not known until that has loaded, and
 * anything shown before then would be the federated graph's schema.
 */
export const isSchemaLoading = ({
  isLoadingGraphSchema,
  isLoadingSubgraphSchema,
  isLoadingFeatureSubgraphSchema,
  isLoadingCompositionFlags,
  isFeatureSubgraphSelected,
}: SchemaLoadingInput): boolean =>
  isLoadingGraphSchema ||
  isLoadingSubgraphSchema ||
  isLoadingFeatureSubgraphSchema ||
  (isFeatureSubgraphSelected && isLoadingCompositionFlags);

export interface SchemaSdls {
  featureSubgraph: string | undefined;
  subgraph: string | undefined;
  /** The federated graph's client schema, which also covers a feature flag selection. */
  graph: string | undefined;
}

/**
 * The SDL for the current selection, or undefined when it has none. Each selection has exactly one
 * schema and its own endpoint, so falling back to another selection's schema would validate
 * operations against something the chosen endpoint does not serve.
 */
export const selectSchemaSdl = (configType: ConfigType, sdls: SchemaSdls): string | undefined => {
  switch (configType) {
    case 'featureSubgraph': {
      return sdls.featureSubgraph;
    }
    case 'subgraph': {
      return sdls.subgraph;
    }
    // A feature flag composes the whole graph, so its schema comes from the federated graph query.
    case 'graph':
    case 'featureFlag': {
      return sdls.graph;
    }
  }
};
