import { DocumentNode, parse, print } from 'graphql';
import { Subgraph } from '../../src';

export function normalizeString(input: string): string {
  return input.replaceAll(/\n| {2,}/g, '');
}

export function documentNodeToNormalizedString(document: DocumentNode): string {
  return normalizeString(print(document));
}

export const versionOneBaseSchema = `
  directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @key(fields: String!) repeatable on OBJECT
  directive @provides(fields: String!) on FIELD_DEFINITION
  directive @requires(fields: String!) on FIELD_DEFINITION
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const versionTwoBaseSchema = versionOneBaseSchema + `
  directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
  directive @shareable on FIELD_DEFINITION | OBJECT
`;

export function createSubgraph(name: string, schemaString: string): Subgraph {
  return {
    definitions: parse(schemaString),
    name,
    url: '',
  };
}