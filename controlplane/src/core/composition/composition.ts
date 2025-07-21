import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationResult,
  NormalizationResult,
  normalizeSubgraphFromString,
  ROUTER_COMPATIBILITY_VERSIONS,
  Subgraph,
  SupportedRouterCompatibilityVersion,
} from '@wundergraph/composition';
import { CompositionOptions } from 'src/types/index.js';

/**
 * Composes a list of subgraphs and returns the result for the base graph and its contract graphs
 */
export function composeFederatedGraphWithPotentialContracts(
  subgraphs: Subgraph[],
  tagOptionsByContractName: Map<string, ContractTagOptions>,
  version: string,
  compositionOptions?: CompositionOptions,
) {
  return federateSubgraphsWithContracts({
    disableResolvabilityValidation: compositionOptions?.disableResolvabilityValidation,
    subgraphs,
    tagOptionsByContractName,
    version: validateRouterCompatibilityVersion(version),
  });
}

/**
 * Composes a list of subgraphs for a contract using a set of exclusion tags
 */
export function composeFederatedContract(
  subgraphs: Subgraph[],
  contractTagOptions: ContractTagOptions,
  version: string,
  compositionOptions?: CompositionOptions,
) {
  return federateSubgraphsContract({
    contractTagOptions,
    disableResolvabilityValidation: compositionOptions?.disableResolvabilityValidation,
    subgraphs,
    version: validateRouterCompatibilityVersion(version),
  });
}

/**
 * Composes a list of subgraphs into a single schema.
 */
export function composeSubgraphs(
  subgraphs: Subgraph[],
  version: string,
  compositionOptions?: CompositionOptions,
): FederationResult {
  return federateSubgraphs({
    disableResolvabilityValidation: compositionOptions?.disableResolvabilityValidation,
    subgraphs,
    version: validateRouterCompatibilityVersion(version),
  });
}

/**
 * Normalizes and builds a GraphQLSchema from a string. It is not the same as buildSchema from graphql-js.
 */
export function buildSchema(schema: string, noLocation = true, version: string): NormalizationResult {
  return normalizeSubgraphFromString(schema, noLocation, validateRouterCompatibilityVersion(version));
}

function validateRouterCompatibilityVersion(version: string): SupportedRouterCompatibilityVersion {
  const castVersion = version as SupportedRouterCompatibilityVersion;
  if (!ROUTER_COMPATIBILITY_VERSIONS.has(castVersion)) {
    throw new Error(
      `Router compatibility version ${version} is not supported by Cosmo.` +
        `Please set one of the following valid versions:\n ` +
        [...ROUTER_COMPATIBILITY_VERSIONS].join(','),
    );
  }
  return castVersion;
}
