import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationResult,
  NormalizationResult,
  normalizeSubgraphFromString,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  ROUTER_COMPATIBILITY_VERSIONS,
  Subgraph,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';

/**
 * Composes a list of subgraphs and returns the result for the base graph and its contract graphs
 */
export function composeFederatedGraphWithPotentialContracts(
  subgraphs: Subgraph[],
  tagOptionsByContractName: Map<string, ContractTagOptions>,
  version: number,
) {
  return federateSubgraphsWithContracts(
    subgraphs,
    tagOptionsByContractName,
    validateRouterCompatibilityVersion(version),
  );
}

/**
 * Composes a list of subgraphs for a contract using a set of exclusion tags
 */
export function composeFederatedContract(
  subgraphs: Subgraph[],
  contractTagOptions: ContractTagOptions,
  version: number,
) {
  return federateSubgraphsContract(subgraphs, contractTagOptions, validateRouterCompatibilityVersion(version));
}

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(subgraphs: Subgraph[], version: number): FederationResult {
  return federateSubgraphs(subgraphs, validateRouterCompatibilityVersion(version));
}

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(schema: string, noLocation = true, version: number): NormalizationResult {
  return normalizeSubgraphFromString(schema, noLocation, validateRouterCompatibilityVersion(version));
}

function validateRouterCompatibilityVersion(version: number): SupportedRouterCompatibilityVersion {
  const castedVersion = version as SupportedRouterCompatibilityVersion;
  if (!ROUTER_COMPATIBILITY_VERSIONS.has(castedVersion)) {
    throw new Error(
      `Router compatibility version ${version} is not supported by Cosmo.` +
        `Please set one of the following valid versions:\n ` +
        [...ROUTER_COMPATIBILITY_VERSIONS].join(','),
    );
  }
  return castedVersion;
}
