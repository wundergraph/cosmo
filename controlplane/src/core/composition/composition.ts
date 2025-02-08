import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationResult,
  NormalizationResult,
  normalizeSubgraphFromString,
  Subgraph,
} from '@wundergraph/composition';

/**
 * Composes a list of subgraphs and returns the result for the base graph and its contract graphs
 */
export function composeSubgraphsWithContracts(
  subgraphs: Subgraph[],
  tagOptionsByContractName: Map<string, ContractTagOptions>,
) {
  return federateSubgraphsWithContracts(subgraphs, tagOptionsByContractName, 1);
}

/**
 * Composes a list of subgraphs for a contract using a set of exclusion tags
 */
export function composeSubgraphsForContract(subgraphs: Subgraph[], contractTagOptions: ContractTagOptions) {
  return federateSubgraphsContract(subgraphs, contractTagOptions, 1);
}

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[]): FederationResult {
  return federateSubgraphs(subgraphs, 1);
}

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(schema: string, noLocation = true): NormalizationResult {
  return normalizeSubgraphFromString(schema, noLocation);
}
