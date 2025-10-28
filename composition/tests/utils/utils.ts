import { DocumentNode, GraphQLSchema, lexicographicSortSchema, print } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  FederationFailure,
  FederationResultWithContractsSuccess,
  FederationSuccess,
  NormalizationFailure,
  NormalizationSuccess,
  normalizeSubgraph,
  Subgraph,
  SupportedRouterCompatibilityVersion,
} from '../../src';
import { expect } from 'vitest';

export function normalizeString(input: string): string {
  return input.replaceAll(/\s+|\\n\s*/g, ' ').trim();
}

export function documentNodeToNormalizedString(document: DocumentNode): string {
  return normalizeString(print(document));
}

export function schemaToSortedNormalizedString(schema: GraphQLSchema): string {
  return normalizeString(printSchemaWithDirectives(lexicographicSortSchema(schema)));
}

export function normalizeSubgraphFailure(
  subgraph: Subgraph,
  version: SupportedRouterCompatibilityVersion,
): NormalizationFailure {
  const result = normalizeSubgraph(subgraph.definitions, subgraph.name, undefined, version);
  expect(result.success, 'normalizeSubgraph succeeded when expected to fail').toBe(false);
  return result as NormalizationFailure;
}

export function normalizeSubgraphSuccess(
  subgraph: Subgraph,
  version: SupportedRouterCompatibilityVersion,
): NormalizationSuccess {
  const result = normalizeSubgraph(subgraph.definitions, subgraph.name, undefined, version);
  if (!result.success) {
    console.dir(result.errors);
  }
  expect(result.success, 'normalizeSubgraph failed when expected to succeed').toBe(true);
  return result as NormalizationSuccess;
}

export function federateSubgraphsFailure(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
  disableResolvabilityValidation = false,
): FederationFailure {
  const result = federateSubgraphs({ disableResolvabilityValidation, subgraphs, version });
  expect(result.success, 'federateSubgraphs succeeded when expected to fail').toBe(false);
  return result as FederationFailure;
}

export function federateSubgraphsSuccess(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
  disableResolvabilityValidation = false,
): FederationSuccess {
  const result = federateSubgraphs({ disableResolvabilityValidation, subgraphs, version });
  if (!result.success) {
    for (const error of result.errors) {
      console.dir(error, { depth: null });
    }
  }
  expect(result.success, 'federateSubgraphs failed when expected to succeed').toBe(true);
  return result as FederationSuccess;
}

export function federateSubgraphsContractSuccess(
  subgraphs: Array<Subgraph>,
  contractTagOptions: ContractTagOptions,
  version: SupportedRouterCompatibilityVersion,
  disableResolvabilityValidation = false,
): FederationSuccess {
  const result = federateSubgraphsContract({
    contractTagOptions,
    disableResolvabilityValidation,
    subgraphs,
    version,
  });
  expect(result.success, 'federateSubgraphsContract failed when expected to succeed').toBe(true);
  return result as FederationSuccess;
}

export function federateSubgraphsWithContractsSuccess(
  subgraphs: Array<Subgraph>,
  tagOptionsByContractName: Map<string, ContractTagOptions>,
  version: SupportedRouterCompatibilityVersion,
  disableResolvabilityValidation = false,
): FederationResultWithContractsSuccess {
  const result = federateSubgraphsWithContracts({
    disableResolvabilityValidation,
    subgraphs,
    tagOptionsByContractName,
    version,
  });
  expect(result.success, 'federateSubgraphsWithContracts failed when expected to succeed').toBe(true);
  return result as FederationResultWithContractsSuccess;
}
