import {
  federateSubgraphs,
  Subgraph,
  NormalizationResultContainer,
  normalizeSubgraphFromString,
  FederationResult,
} from '@wundergraph/composition';

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[]): FederationResult {
  return federateSubgraphs(subgraphs);
}

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(schema: string): NormalizationResultContainer {
  return normalizeSubgraphFromString(schema);
}
