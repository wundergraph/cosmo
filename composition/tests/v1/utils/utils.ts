import { MutableIntermediateTypeNode, MutableTypeNode } from '../../../src';
import { Kind, TypeNode } from 'graphql/index';

export const AUTHENTICATED_DIRECTIVE = `
  directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
`;

export const CONFIGURE_DESCRIPTION_DIRECTIVE = `
  directive @openfed__configureDescription(descriptionOverride: String, propagate: Boolean! = true) on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | SCHEMA | UNION
`;

export const CONNECT_FIELD_RESOLVER_DIRECTIVE = `
  directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
`;

export const EDFS_NATS_PUBLISH_DIRECTIVE = `
  directive @edfs__natsPublish(providerId: String! = "default", subject: String!) on FIELD_DEFINITION
`;

export const EDFS_NATS_REQUEST_DIRECTIVE = `
  directive @edfs__natsRequest(providerId: String! = "default", subject: String!) on FIELD_DEFINITION
`;

export const EDFS_NATS_SUBSCRIBE_DIRECTIVE = `
  directive @edfs__natsSubscribe(providerId: String! = "default", streamConfiguration: edfs__NatsStreamConfiguration, subjects: [String!]!) on FIELD_DEFINITION
`;

export const EDFS_NATS_STREAM_CONFIGURATION_INPUT = `
  input edfs__NatsStreamConfiguration {
    consumerInactiveThreshold: Int! = 30
    consumerName: String!
    streamName: String!
  }
`;

export const EDFS_PUBLISH_RESULT_OBJECT = `
  type edfs__PublishResult {
   success: Boolean!
  }
`;

export const EXTENDS_DIRECTIVE = `
  directive @extends on INTERFACE | OBJECT
`;

export const EXTERNAL_DIRECTIVE = `
  directive @external on FIELD_DEFINITION | OBJECT
`;

export const INACCESSIBLE_DIRECTIVE = `
  directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION 
    | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const INTERFACE_OBJECT_DIRECTIVE = `
  directive @interfaceObject on OBJECT
`;

export const REQUEST_FETCH_REASONS_DIRECTIVE = `
  directive @openfed__requireFetchReasons repeatable on FIELD_DEFINITION | INTERFACE | OBJECT
`;

export const REQUIRES_SCOPES_DIRECTIVE = `
  directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
`;

export const KEY_DIRECTIVE = `
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
`;

export const OPENFED_FIELD_SET = `  scalar openfed__FieldSet`;

export const OPENFED_SCOPE = `  scalar openfed__Scope`;

export const OPENFED_SUBSCRIPTION_FIELD_CONDITION = `
  input openfed__SubscriptionFieldCondition {
    fieldPath: String!
    values: [openfed__SubscriptionFilterValue]!
  }
`;

export const OPENFED_SUBSCRIPTION_FILTER_CONDITION = `
  input openfed__SubscriptionFilterCondition {
    AND: [openfed__SubscriptionFilterCondition!]
    IN: openfed__SubscriptionFieldCondition
    NOT: openfed__SubscriptionFilterCondition
    OR: [openfed__SubscriptionFilterCondition!]
  }
`;

export const OPENFED_SUBSCRIPTION_FILTER_VALUE = `
  scalar openfed__SubscriptionFilterValue
`;

export const ONE_OF_DIRECTIVE = `
  directive @oneOf on INPUT_OBJECT
`;

export const REQUIRES_DIRECTIVE = `
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
`;

export const SEMANTIC_NON_NULL_DIRECTIVE = `
  directive @semanticNonNull(levels: [Int!]! = [0]) on FIELD_DEFINITION
`;

export const SHAREABLE_DIRECTIVE = `
  directive @shareable repeatable on FIELD_DEFINITION | OBJECT
`;

export const SUBSCRIPTION_FILTER_DIRECTIVE = `
  directive @openfed__subscriptionFilter(condition: openfed__SubscriptionFilterCondition!) on FIELD_DEFINITION
`;

export const TAG_DIRECTIVE = `
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

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

export const SCHEMA_QUERY_DEFINITION = `
  schema {
    query: Query
  }
`;

export const SCHEMA_QUERY_SUBSCRIPTION_DEFINITION = `
  schema {
    query: Query
    subscription: Subscription
  }
`;

export const SCHEMA_ALL_ROOTS_DEFINITION = `
  schema {
    query: Query
    mutation: Mutation
    subscription: Subscription
  }
`;

export const SCHEMA_SUBSCRIPTION_DEFINITION = `
  schema {
    subscription: Subscription
  }
`;

export const versionOnePersistedDirectiveDefinitions = `
    directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

export const eventDirectiveDefinitions = `
  directive @edfs__natsPublish(providerId: String! = "default", subject: String!) on FIELD_DEFINITION
  directive @edfs__natsRequest(providerId: String! = "default", subject: String!) on FIELD_DEFINITION
  directive @edfs__natsSubscribe(providerId: String! = "default", streamConfiguration: edfs__NatsStreamConfiguration, subjects: [String!]!) on FIELD_DEFINITION
`;

export const versionTwoRouterDirectiveDefinitions = `
    directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
    directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
    directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
    directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
`;

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
