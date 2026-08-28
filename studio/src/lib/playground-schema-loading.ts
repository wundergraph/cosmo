export interface PlaygroundSchemaLoadingInput {
  isLoadingGraphSchema: boolean;
  isLoadingSubgraphSchema: boolean;
  isLoadingFeatureSubgraphSchema: boolean;
  /** True while the feature flag list, which resolves a feature subgraph selection, is in flight. */
  isLoadingCompositionFlags: boolean;
  isFeatureSubgraphSelected: boolean;
}

/**
 * Whether the playground should withhold the schema from GraphiQL. A feature subgraph selection is
 * resolved from the feature flag list, so it is not yet known which schema to fetch until that has
 * loaded. Handing GraphiQL a schema before then would give it the federated graph's.
 */
export const isPlaygroundSchemaLoading = ({
  isLoadingGraphSchema,
  isLoadingSubgraphSchema,
  isLoadingFeatureSubgraphSchema,
  isLoadingCompositionFlags,
  isFeatureSubgraphSelected,
}: PlaygroundSchemaLoadingInput): boolean =>
  isLoadingGraphSchema ||
  isLoadingSubgraphSchema ||
  isLoadingFeatureSubgraphSchema ||
  (isFeatureSubgraphSelected && isLoadingCompositionFlags);
