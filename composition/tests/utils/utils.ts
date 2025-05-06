import { DocumentNode, GraphQLSchema, lexicographicSortSchema, print } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';
import {
  federateSubgraphs,
  FederationResultFailure,
  FederationResultSuccess,
  NormalizationResultFailure,
  NormalizationResultSuccess,
  normalizeSubgraph,
  Subgraph,
  SupportedRouterCompatibilityVersion,
} from '../../src';
import { expect } from 'vitest';

export function normalizeString(input: string): string {
  return input.replaceAll(/\n| {2,}/g, '');
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
): NormalizationResultFailure {
  const result = normalizeSubgraph(subgraph.definitions, subgraph.name, undefined, version);
  expect(result.success, 'normalizeSubgraph succeeded when expected to fail').toBe(false);
  return result as NormalizationResultFailure;
}

export function normalizeSubgraphSuccess(
  subgraph: Subgraph,
  version: SupportedRouterCompatibilityVersion,
): NormalizationResultSuccess {
  const result = normalizeSubgraph(subgraph.definitions, subgraph.name, undefined, version);
  expect(result.success, 'normalizeSubgraph failed when expected to succeed').toBe(true);
  return result as NormalizationResultSuccess;
}

export function federateSubgraphsFailure(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
): FederationResultFailure {
  const result = federateSubgraphs(subgraphs, version);
  expect(result.success, 'federateSubgraphs succeeded when expected to fail').toBe(false);
  return result as FederationResultFailure;
}

export function federateSubgraphsSuccess(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
): FederationResultSuccess {
  const result = federateSubgraphs(subgraphs, version);
  expect(result.success, 'federateSubgraphs failed when expected to succeed').toBe(true);
  return result as FederationResultSuccess;
}
