import {
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationResultContainer,
  NormalizationResultContainer,
  normalizeSubgraphFromString,
  Subgraph,
} from '@wundergraph/composition';

/**
 * Composes a list of subgraphs and returns the result for the base graph and its contract graphs
 */
export function composeSubgraphsWithContracts(
  subgraphs: Subgraph[],
  tagExclusionsByContractName: Map<string, Set<string>>,
) {
  return federateSubgraphsWithContracts(subgraphs, tagExclusionsByContractName);
}

/**
 * Composes a list of subgraphs for a contract using a set of exclusion tags
 */
export function composeSubgraphsForContract(subgraphs: Subgraph[], tagExclusions: Set<string>) {
  return federateSubgraphsContract(subgraphs, tagExclusions);
}

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
