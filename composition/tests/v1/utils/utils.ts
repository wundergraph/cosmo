import { MutableIntermediateTypeNode, MutableTypeNode } from '../../../src';
import { Kind, TypeNode } from 'graphql/index';

// The V1 definitions that are required during normalization
export const versionOneBaseSchema = `
  directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @specifiedBy(url: String!) on SCALAR
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

  scalar openfed__FieldSet
`;

export const baseDirectiveDefinitions = `
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const baseDirectiveDefinitionsWithConfigureDescription = `
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @openfed__configureDescription(descriptionOverride: String, propagate: Boolean! = true) on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | SCHEMA | UNION
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const baseDirectiveDefinitionsWithSemanticNonNull = `
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @semanticNonNull(levels: [Int!]! = [0]) on FIELD_DEFINITION
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const baseDirectiveDefinitionsWithRequireFetchReasons = `
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @openfed__requireFetchReasons repeatable on FIELD_DEFINITION | OBJECT
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const versionTwoDirectiveDefinitions = `
  directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @composeDirective(name: String!) repeatable on SCHEMA
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
  directive @interfaceObject on OBJECT
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @override(from: String!) on FIELD_DEFINITION
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @shareable repeatable on FIELD_DEFINITION | OBJECT
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
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
  directive @override(from: String!) on FIELD_DEFINITION
  directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @shareable repeatable on FIELD_DEFINITION | OBJECT
  
  scalar openfed__Scope
`;

export const schemaQueryDefinition = `
schema {
  query: Query
}`;

export const fullDefaultSchemaDefinition = `
schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}`;

export const versionOnePersistedDirectiveDefinitions = `
    directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const eventDirectiveDefinitions = `
  directive @edfs__natsPublish(providerId: String! = "default", subject: String!) on FIELD_DEFINITION
  directive @edfs__natsRequest(providerId: String! = "default", subject: String!) on FIELD_DEFINITION
  directive @edfs__natsSubscribe(providerId: String! = "default", streamConfiguration: edfs__NatsStreamConfiguration, subjects: [String!]!) on FIELD_DEFINITION
`;

export const semanticNonNullDefinition = `directive @semanticNonNull(levels: [Int!]! = [0]) on FIELD_DEFINITION`;

export const versionOneRouterDefinitions = schemaQueryDefinition + versionOnePersistedDirectiveDefinitions;

export const versionOneRouterDefinitionsWithSemanticNonNull =
  schemaQueryDefinition + semanticNonNullDefinition + versionOnePersistedDirectiveDefinitions;

export const versionOneRouterContractDefinitions =
  schemaQueryDefinition +
  `directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION` +
  versionOnePersistedDirectiveDefinitions;

export const versionOneFullEventDefinitions =
  fullDefaultSchemaDefinition + eventDirectiveDefinitions + baseDirectiveDefinitions;

export const versionOneSubscriptionEventDefinitions =
  `
schema {
  subscription: Subscription
}
directive @edfs__natsSubscribe(providerId: String! = "default", streamConfiguration: edfs__NatsStreamConfiguration, subjects: [String!]!) on FIELD_DEFINITION
` + baseDirectiveDefinitions;

export const versionTwoRouterDirectiveDefinitions = `
    directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
    directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
    directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
    directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const versionTwoRouterDefinitions = schemaQueryDefinition + versionTwoRouterDirectiveDefinitions;

export function stringToTypeNode(input: string): TypeNode {
  input = input.replaceAll('[', '');
  let typeNode: MutableIntermediateTypeNode;
  let lastNode: MutableIntermediateTypeNode | undefined;
  const lastIndex = input.length - 1;
  for (let i = lastIndex; i > -1; i--) {
    const character = input[i];
    switch (character) {
      case '!':
        if (lastNode) {
          lastNode.type = { kind: Kind.NON_NULL_TYPE, type: {} as MutableTypeNode };
          lastNode = lastNode.type;
        } else {
          typeNode = { kind: Kind.NON_NULL_TYPE, type: {} as MutableTypeNode };
          lastNode = typeNode;
        }
        break;
      case ']':
        if (lastNode) {
          lastNode.type = { kind: Kind.LIST_TYPE, type: {} as MutableTypeNode };
          lastNode = lastNode.type;
        } else {
          typeNode = { kind: Kind.LIST_TYPE, type: {} as MutableTypeNode };
          lastNode = typeNode;
        }
        break;
      default:
        const node: MutableTypeNode = {
          kind: Kind.NAMED_TYPE,
          name: { kind: Kind.NAME, value: input.slice(0, i + 1) },
        };
        if (lastNode) {
          lastNode.type = node;
          return typeNode! as TypeNode;
        }
        return node as TypeNode;
    }
  }
  throw new Error('Could not parse string.');
}
