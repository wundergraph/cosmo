import { buildSchema, DocumentNode, GraphQLSchema, lexicographicSortSchema, parse, print } from 'graphql';
import { Subgraph } from '../../src';
import { printSchemaWithDirectives } from '@graphql-tools/utils';

export function normalizeString(input: string): string {
  return input.replaceAll(/\n| {2,}/g, '');
}

export function sortedNormalizedVersionTwoSchemaString(input: string): string {
  return schemaToSortedNormalizedString(buildSchema(versionTwoPersistedBaseSchema + input));
}

export function documentNodeToNormalizedString(document: DocumentNode): string {
  return normalizeString(print(document));
}

export function schemaToSortedNormalizedString(schema: GraphQLSchema): string {
  return normalizeString(printSchemaWithDirectives(lexicographicSortSchema(schema)));
}

// The V1 definitions that are required during normalization
export const versionOneBaseSchema = `
  directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @eventsPublish(topic: String!, sourceID: String) on FIELD_DEFINITION
  directive @eventsRequest(topic: String!, sourceID: String) on FIELD_DEFINITION
  directive @eventsSubscribe(topic: String!, sourceID: String) on FIELD_DEFINITION
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @specifiedBy(url: String!) on SCALAR
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

  scalar openfed__FieldSet
`;

// The V1 definitions that are persisted in the raw federated schema
export const versionOnePersistedBaseSchema = `
  directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

// The V2 definitions that are required during normalization
export const versionTwoBaseSchema =
  versionOneBaseSchema +
  `
  directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @composeDirective(name: String!) repeatable on SCHEMA
  directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
  directive @interfaceObject on OBJECT
  directive @link(url: String!, as: String, for: String, import: [String]) repeatable on SCHEMA
  directive @override(from: String!) on FIELD_DEFINITION
  directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @shareable on FIELD_DEFINITION | OBJECT
  
  scalar openfed__Scope
`;

// The V2 definitions that are persisted in the raw federated schema
export const versionTwoPersistedBaseSchema =
  versionOnePersistedBaseSchema +
  `
  directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
  directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  
  scalar openfed__Scope
`;

export const schemaQueryDefinition = `
schema {
  query: Query
}`;

export const versionOnePersistedDirectiveDefinitions = `
    directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const versionOneSchemaQueryAndPersistedDirectiveDefinitions =
  schemaQueryDefinition + versionOnePersistedDirectiveDefinitions;

export const versionTwoPersistedDirectiveDefinitions = `
    directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
    directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
    directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
    directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const versionTwoSchemaQueryAndPersistedDirectiveDefinitions =
  schemaQueryDefinition + versionTwoPersistedDirectiveDefinitions;

export function createSubgraph(name: string, schemaString: string): Subgraph {
  return {
    definitions: parse(schemaString),
    name,
    url: '',
  };
}
