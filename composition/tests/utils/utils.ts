import { DocumentNode, GraphQLSchema, lexicographicSortSchema, print } from 'graphql';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

export function normalizeString(input: string): string {
  return input.replaceAll(/\n| {2,}/g, '');
}

export function documentNodeToNormalizedString(document: DocumentNode): string {
  return normalizeString(print(document));
}

export function schemaToSortedNormalizedString(schema: GraphQLSchema): string {
  return normalizeString(printSchemaWithDirectives(lexicographicSortSchema(schema)));
}
