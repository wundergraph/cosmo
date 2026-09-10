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
