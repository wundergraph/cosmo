import { type GraphQLSchema, lexicographicSortSchema } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  type CompositionOptions,
  type ContractTagOptions,
  federateSubgraphs,
  federateSubgraphsContract,
  federateSubgraphsWithContracts,
  type FederationFailure,
  type FederationResultWithContractsSuccess,
  type FederationSuccess,
  type NormalizationFailure,
  type NormalizationSuccess,
  normalizeSubgraph,
  normalizeSubgraphFromString,
  type NormalizeSubgraphFromStringParams,
  parse,
  type Subgraph,
  type SubgraphName,
  type SupportedRouterCompatibilityVersion,
} from '../../src';
import { expect } from 'vitest';

export function normalizeString(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function schemaToSortedNormalizedString(schema: GraphQLSchema): string {
  return normalizeString(printSchemaWithDirectives(lexicographicSortSchema(schema)));
}

export function normalizeSubgraphFromStringFailure(params: NormalizeSubgraphFromStringParams): NormalizationFailure {
  const result = normalizeSubgraphFromString(params);
  expect(result.success, 'normalizeSubgraph succeeded when expected to fail').toBe(false);
  return result as NormalizationFailure;
}

export function normalizeSubgraphFailure(
  subgraph: Subgraph,
  version: SupportedRouterCompatibilityVersion,
  options?: CompositionOptions,
): NormalizationFailure {
  const result = normalizeSubgraph({
    document: subgraph.definitions,
    options,
    subgraphName: subgraph.name,
    version,
  });
  expect(result.success, 'normalizeSubgraph succeeded when expected to fail').toBe(false);
  return result as NormalizationFailure;
}

export function normalizeSubgraphSuccess(
  subgraph: Subgraph,
  version: SupportedRouterCompatibilityVersion,
  options?: CompositionOptions,
): NormalizationSuccess {
  const result = normalizeSubgraph({
    document: subgraph.definitions,
    options,
    subgraphName: subgraph.name,
    version,
  });
  if (!result.success) {
    console.dir(result.errors, { depth: null });
  }
  expect(result.success, 'normalizeSubgraph failed when expected to succeed').toBe(true);
  return result as NormalizationSuccess;
}

export function federateSubgraphsFailure(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
  options?: CompositionOptions,
): FederationFailure {
  const result = federateSubgraphs({ options, subgraphs, version });
  expect(result.success, 'federateSubgraphs succeeded when expected to fail').toBe(false);
  return result as FederationFailure;
}

export function federateSubgraphsSuccess(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
  options?: CompositionOptions,
): FederationSuccess {
  const result = federateSubgraphs({ options, subgraphs, version });
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
  options?: CompositionOptions,
): FederationSuccess {
  const result = federateSubgraphsContract({
    contractTagOptions,
    options,
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
  options?: CompositionOptions,
): FederationResultWithContractsSuccess {
  const result = federateSubgraphsWithContracts({
    options,
    subgraphs,
    tagOptionsByContractName,
    version,
  });
  expect(result.success, 'federateSubgraphsWithContracts failed when expected to succeed').toBe(true);
  return result as FederationResultWithContractsSuccess;
}

export function createSubgraph(name: SubgraphName, sdlString: string): Subgraph {
  return {
    definitions: parse(sdlString),
    name,
    url: '',
  };
}
