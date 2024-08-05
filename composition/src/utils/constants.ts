import {
  DEFAULT_DEPRECATION_REASON,
  DirectiveDefinitionNode,
  InputObjectTypeDefinitionNode,
  Kind,
  ScalarTypeDefinitionNode,
} from 'graphql';
import { stringArrayToNameNodeArray, stringToNamedTypeNode, stringToNameNode } from '../ast/utils';
import {
  AND_UPPER,
  ARGUMENT_DEFINITION_UPPER,
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  COMPOSE_DIRECTIVE,
  CONDITION,
  CONSUMER_NAME,
  DEFAULT_EDFS_PROVIDER_ID,
  DEPRECATED,
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_STREAM_CONFIGURATION,
  EDFS_NATS_SUBSCRIBE,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXTENDS,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELD_PATH,
  FIELD_SET_SCALAR,
  FIELDS,
  FROM,
  IN_UPPER,
  INACCESSIBLE,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_OBJECT,
  INTERFACE_UPPER,
  KEY,
  LINK,
  NAME,
  NOT_UPPER,
  OBJECT_UPPER,
  OR_UPPER,
  OVERRIDE,
  PROVIDER_ID,
  PROVIDES,
  REASON,
  REQUIRES,
  REQUIRES_SCOPES,
  RESOLVABLE,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SCOPE_SCALAR,
  SCOPES,
  SHAREABLE,
  SPECIFIED_BY,
  STREAM_NAME,
  STRING_SCALAR,
  SUBJECT,
  SUBJECTS,
  SUBSCRIPTION_FIELD_CONDITION,
  SUBSCRIPTION_FILTER,
  SUBSCRIPTION_FILTER_CONDITION,
  SUBSCRIPTION_FILTER_VALUE,
  TAG,
  TOPIC,
  TOPICS,
  UNION_UPPER,
  URL_LOWER,
  VALUES,
} from './string-constants';
import { MutableDirectiveDefinitionNode, MutableInputObjectNode, MutableScalarNode } from '../schema-building/ast';

export const BASE_SCALARS = new Set<string>([
  '_Any',
  '_Entities',
  'Boolean',
  'Float',
  'ID',
  'Int',
  FIELD_SET_SCALAR,
  SCOPE_SCALAR,
  STRING_SCALAR,
]);

/* directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE |
 FIELD_DEFINITION | INPUT_FIELD_DEFINITION
*/
export const DEPRECATED_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(REASON),
      type: stringToNamedTypeNode(STRING_SCALAR),
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_DEPRECATION_REASON,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_VALUE_UPPER,
    FIELD_DEFINITION_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
  ]),
  name: stringToNameNode(DEPRECATED),
  repeatable: false,
};

// directive @extends on INTERFACE | OBJECT
const EXTENDS_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([INTERFACE_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(EXTENDS),
  repeatable: false,
};

// directive @external on FIELD_DEFINITION | OBJECT
const EXTERNAL_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(EXTERNAL),
  repeatable: false,
};

// directive @edfs__kafkaPublish(topic: String!, providerId: String! = "kafka") on FIELD_DEFINITION
const EDFS_KAFKA_PUBLISH_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(TOPIC),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_KAFKA_PUBLISH),
  repeatable: false,
};

// directive @edfs__kafkaSubscribe(topics: [String!]!, providerId: String! = "kafka") on FIELD_DEFINITION
const EDFS_KAFKA_SUBSCRIBE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(TOPICS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: stringToNamedTypeNode(STRING_SCALAR),
          },
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_KAFKA_PUBLISH),
  repeatable: false,
};

// directive @edfs__natsPublish(subject: String!, providerId: String! = "default") on FIELD_DEFINITION
const EDFS_NATS_PUBLISH_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SUBJECT),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_NATS_PUBLISH),
  repeatable: false,
};

// directive @edfs__natsRequest(subject: String!, providerId String! = "default") on FIELD_DEFINITION
const EDFS_NATS_REQUEST_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SUBJECT),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_NATS_REQUEST),
  repeatable: false,
};

// directive @edfs__natsSubscribe(subjects: [String!]!, providerId: String! = "default", streamConfiguration: edfs__NatsStreamConfiguration) on FIELD_DEFINITION
const EDFS_NATS_SUBSCRIBE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SUBJECTS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: stringToNamedTypeNode(STRING_SCALAR),
          },
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode('streamConfiguration'),
      type: stringToNamedTypeNode(EDFS_NATS_STREAM_CONFIGURATION),
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_NATS_SUBSCRIBE),
  repeatable: false,
};

// directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
const KEY_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELDS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(FIELD_SET_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(RESOLVABLE),
      type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      defaultValue: {
        kind: Kind.BOOLEAN,
        value: true,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([INTERFACE_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(KEY),
  repeatable: true,
};

// directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
const PROVIDES_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELDS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(FIELD_SET_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(PROVIDES),
  repeatable: false,
};

// directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
const REQUIRES_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELDS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(FIELD_SET_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(REQUIRES),
  repeatable: false,
};

// directive @specifiedBy(url: String!) on SCALAR
const SPECIFIED_BY_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(URL_LOWER),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([SCALAR_UPPER]),
  name: stringToNameNode(SPECIFIED_BY),
  repeatable: false,
};

/* directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION
  | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
*/
export const TAG_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(NAME),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_UPPER,
    ENUM_VALUE_UPPER,
    FIELD_DEFINITION_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
    INPUT_OBJECT_UPPER,
    INTERFACE_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
    UNION_UPPER,
  ]),
  name: stringToNameNode(TAG),
  repeatable: true,
};

export const BASE_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME = new Map<string, DirectiveDefinitionNode>([
  [DEPRECATED, DEPRECATED_DEFINITION],
  [EXTENDS, EXTENDS_DEFINITION],
  [EXTERNAL, EXTERNAL_DEFINITION],
  [EDFS_KAFKA_PUBLISH, EDFS_KAFKA_PUBLISH_DEFINITION],
  [EDFS_KAFKA_SUBSCRIBE, EDFS_KAFKA_SUBSCRIBE_DEFINITION],
  [EDFS_NATS_PUBLISH, EDFS_NATS_PUBLISH_DEFINITION],
  [EDFS_NATS_REQUEST, EDFS_NATS_REQUEST_DEFINITION],
  [EDFS_NATS_SUBSCRIBE, EDFS_NATS_SUBSCRIBE_DEFINITION],
  [KEY, KEY_DEFINITION],
  [PROVIDES, PROVIDES_DEFINITION],
  [REQUIRES, REQUIRES_DEFINITION],
  [SPECIFIED_BY, SPECIFIED_BY_DEFINITION],
  [TAG, TAG_DEFINITION],
]);

// @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
export const AUTHENTICATED_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([
    ENUM_UPPER,
    FIELD_DEFINITION_UPPER,
    INTERFACE_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
  ]),
  name: stringToNameNode(AUTHENTICATED),
  repeatable: false,
};

// @composeDirective is currently unimplemented
/* directive @composeDirective(name: String!) repeatable on SCHEMA */
const COMPOSE_DIRECTIVE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(NAME),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([SCHEMA_UPPER]),
  name: stringToNameNode(COMPOSE_DIRECTIVE),
  repeatable: true,
};

/* directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_OBJECT |
   INPUT_FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR | UNION
*/
export const INACCESSIBLE_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_UPPER,
    ENUM_VALUE_UPPER,
    FIELD_DEFINITION_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
    INPUT_OBJECT_UPPER,
    INTERFACE_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
    UNION_UPPER,
  ]),
  name: stringToNameNode(INACCESSIBLE),
  repeatable: false,
};

// directive @interfaceObject on OBJECT
const INTERFACE_OBJECT_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([OBJECT_UPPER]),
  name: stringToNameNode(INTERFACE_OBJECT),
  repeatable: false,
};

// directive @link(url: String!, as: String!, for: String, import: [String]) repeatable on SCHEMA
const LINK_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(URL_LOWER),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode('as'),
      type: stringToNamedTypeNode(STRING_SCALAR),
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode('for'),
      type: stringToNamedTypeNode(STRING_SCALAR),
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode('import'),
      type: {
        kind: Kind.LIST_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([SCHEMA_UPPER]),
  name: stringToNameNode(LINK),
  repeatable: true,
};

// directive @override(from: String!) on FIELD_DEFINITION
const OVERRIDE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FROM),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
  name: stringToNameNode(OVERRIDE),
  repeatable: false,
};

// @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
export const REQUIRES_SCOPES_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SCOPES),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: {
              kind: Kind.LIST_TYPE,
              type: {
                kind: Kind.NON_NULL_TYPE,
                type: stringToNamedTypeNode(SCOPE_SCALAR),
              },
            },
          },
        },
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([
    ENUM_UPPER,
    FIELD_DEFINITION_UPPER,
    INTERFACE_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
  ]),
  name: stringToNameNode(REQUIRES_SCOPES),
  repeatable: false,
};

// directive @shareable on FIELD_DEFINITION | OBJECT
const SHAREABLE_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(SHAREABLE),
  repeatable: false,
};

// directive @openfed__subscriptionFilter(condition: openfed__SubscriptionFilterCondition!) on FIELD_DEFINITION
export const SUBSCRIPTION_FILTER_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CONDITION),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
  name: stringToNameNode(SUBSCRIPTION_FILTER),
  repeatable: false,
};

/* input openfed__SubscriptionFilterCondition {
 *   AND: [openfed__SubscriptionFilterCondition!]
 *   IN: openfed__SubscriptionFieldCondition
 *   NOT: openfed__SubscriptionFilterCondition
 *   OR: [openfed__SubscriptionFilterCondition!]
 * }
 */
export const SUBSCRIPTION_FILTER_CONDITION_DEFINITION: InputObjectTypeDefinitionNode = {
  fields: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(AND_UPPER),
      type: {
        kind: Kind.LIST_TYPE,
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(IN_UPPER),
      type: stringToNamedTypeNode(SUBSCRIPTION_FIELD_CONDITION),
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(OR_UPPER),
      type: {
        kind: Kind.LIST_TYPE,
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(NOT_UPPER),
      type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
    },
  ],
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
  name: stringToNameNode(SUBSCRIPTION_FILTER_CONDITION),
};

// scalar openfed__SubscriptionFilterValue
export const SUBSCRIPTION_FILTER_VALUE_DEFINITION: MutableScalarNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(SUBSCRIPTION_FILTER_VALUE),
};

/* input openfed__SubscriptionFieldCondition {
 *   fieldPath: String!
 *   values: [openfed__SubscriptionFilterValue]!
 * }
 */
export const SUBSCRIPTION_FIELD_CONDITION_DEFINITION: InputObjectTypeDefinitionNode = {
  fields: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELD_PATH),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(VALUES),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_VALUE),
        },
      },
    },
  ],
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
  name: stringToNameNode(SUBSCRIPTION_FIELD_CONDITION),
};

export const V2_DIRECTIVE_DEFINITION_BY_DIRECTIVE_NAME = new Map<string, DirectiveDefinitionNode>([
  [AUTHENTICATED, AUTHENTICATED_DEFINITION],
  [COMPOSE_DIRECTIVE, COMPOSE_DIRECTIVE_DEFINITION],
  [INACCESSIBLE, INACCESSIBLE_DEFINITION],
  [INTERFACE_OBJECT, INTERFACE_OBJECT_DEFINITION],
  [LINK, LINK_DEFINITION],
  [OVERRIDE, OVERRIDE_DEFINITION],
  [REQUIRES_SCOPES, REQUIRES_SCOPES_DEFINITION],
  [SHAREABLE, SHAREABLE_DEFINITION],
]);

export const BASE_DIRECTIVE_DEFINITIONS: DirectiveDefinitionNode[] = [
  DEPRECATED_DEFINITION,
  EXTENDS_DEFINITION,
  EXTERNAL_DEFINITION,
  KEY_DEFINITION,
  PROVIDES_DEFINITION,
  REQUIRES_DEFINITION,
  SPECIFIED_BY_DEFINITION,
  TAG_DEFINITION,
];

export const EVENT_DRIVEN_DIRECTIVE_DEFINITIONS_BY_DIRECTIVE_NAME = new Map<string, DirectiveDefinitionNode>([
  [EDFS_KAFKA_PUBLISH, EDFS_KAFKA_PUBLISH_DEFINITION],
  [EDFS_KAFKA_SUBSCRIBE, EDFS_KAFKA_SUBSCRIBE_DEFINITION],
  [EDFS_NATS_PUBLISH, EDFS_NATS_PUBLISH_DEFINITION],
  [EDFS_NATS_REQUEST, EDFS_NATS_REQUEST_DEFINITION],
  [EDFS_NATS_SUBSCRIBE, EDFS_NATS_SUBSCRIBE_DEFINITION],
]);

export const VERSION_TWO_DIRECTIVE_DEFINITIONS: DirectiveDefinitionNode[] = [
  AUTHENTICATED_DEFINITION,
  COMPOSE_DIRECTIVE_DEFINITION,
  INACCESSIBLE_DEFINITION,
  INTERFACE_OBJECT_DEFINITION,
  LINK_DEFINITION,
  OVERRIDE_DEFINITION,
  REQUIRES_SCOPES_DEFINITION,
  SHAREABLE_DEFINITION,
];

export const FIELD_SET_SCALAR_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(FIELD_SET_SCALAR),
};

// scalar openfed__Scope
export const SCOPE_SCALAR_DEFINITION: MutableScalarNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(SCOPE_SCALAR),
};

/*
 * input edfs__NatsStreamConfiguration {
 *   consumerName: String!
 *   streamName: String!
 * }
 * */
export const EDFS_NATS_STREAM_CONFIGURATION_DEFINITION: MutableInputObjectNode = {
  kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
  name: stringToNameNode(EDFS_NATS_STREAM_CONFIGURATION),
  fields: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CONSUMER_NAME),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(STREAM_NAME),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    },
  ],
};

export const INHERITABLE_DIRECTIVE_NAMES = [EXTERNAL, SHAREABLE];

export const baseDirectives = `
  directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  directive @extends on INTERFACE | OBJECT
  directive @external on FIELD_DEFINITION | OBJECT
  directive @edfs__kafkaPublish(topic: String!, providerId: String! = "default") on FIELD_DEFINITION
  directive @edfs__kafkaSubscribe(topic: String!, providerId: String! = "default") on FIELD_DEFINITION
  directive @edfs__natsPublish(subject: String!, providerId: String! = "default") on FIELD_DEFINITION
  directive @edfs__natsRequest(subject: String!, providerId: String! = "default") on FIELD_DEFINITION
  directive @edfs__natsSubscribe(subjects: [String!]!, id: String! = "default", streamConfiguration: edfs__NatsStreamConfiguration) on FIELD_DEFINITION
  directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
  directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  directive @specifiedBy(url: String!) on SCALAR
  directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
  directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @composeDirective(name: String!) repeatable on SCHEMA
  directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
  directive @interfaceObject on OBJECT
  directive @link(url: String!, as: String, for: String, import: [String]) repeatable on SCHEMA
  directive @override(from: String!) on FIELD_DEFINITION
  directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  directive @shareable on FIELD_DEFINITION | OBJECT
  scalar openfed__FieldSet
  scalar openfed__Scope
  input edfs__NatsStreamConfiguration {
    consumerName: String!
    streamName: String!
  }
`;
