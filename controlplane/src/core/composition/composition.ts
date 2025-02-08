import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationResult,
  NormalizationResult,
  normalizeSubgraphFromString, ROUTER_COMPATIBILITY_VERSION_ONE,
  Subgraph,
} from '@wundergraph/composition';

/**
 * Composes a list of subgraphs and returns the result for the base graph and its contract graphs
 */
export function composeSubgraphsWithContracts(
  subgraphs: Subgraph[],
  tagOptionsByContractName: Map<string, ContractTagOptions>,
) {
  // @TODO get router compatibility version programmatically
  return federateSubgraphsWithContracts(subgraphs, tagOptionsByContractName, ROUTER_COMPATIBILITY_VERSION_ONE);
}

/**
 * Composes a list of subgraphs for a contract using a set of exclusion tags
 */
export function composeSubgraphsForContract(subgraphs: Subgraph[], contractTagOptions: ContractTagOptions) {
  // @TODO get router compatibility version programmatically
  return federateSubgraphsContract(subgraphs, contractTagOptions, ROUTER_COMPATIBILITY_VERSION_ONE);
}

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[]): FederationResult {
  // @TODO get router compatibility version programmatically
  return federateSubgraphs(subgraphs, ROUTER_COMPATIBILITY_VERSION_ONE);
}

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(schema: string, noLocation = true): NormalizationResult {
  // @TODO get router compatibility version programmatically
  return normalizeSubgraphFromString(schema, noLocation, ROUTER_COMPATIBILITY_VERSION_ONE);
}
