import {
  federateSubgraphs,
  FederationResultContainer,
  NormalizationResultContainer,
  normalizeSubgraphFromString,
  Subgraph,
} from '@wundergraph/composition';

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[]): FederationResultContainer {
  return federateSubgraphs(subgraphs);
}

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(schema: string): NormalizationResultContainer {
  return normalizeSubgraphFromString(schema);
}
