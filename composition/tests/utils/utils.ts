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
  return normalizeSubgraph(subgraph.definitions, subgraph.name, undefined, version) as NormalizationResultFailure;
}

export function normalizeSubgraphSuccess(
  subgraph: Subgraph,
  version: SupportedRouterCompatibilityVersion,
): NormalizationResultSuccess {
  return normalizeSubgraph(subgraph.definitions, subgraph.name, undefined, version) as NormalizationResultSuccess;
}

export function federateSubgraphsFailure(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
): FederationResultFailure {
  return federateSubgraphs(subgraphs, version) as FederationResultFailure;
}

export function federateSubgraphsSuccess(
  subgraphs: Array<Subgraph>,
  version: SupportedRouterCompatibilityVersion,
): FederationResultSuccess {
  return federateSubgraphs(subgraphs, version) as FederationResultSuccess;
}
