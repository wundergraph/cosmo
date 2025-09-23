import {
  DEFAULT_DEPRECATION_REASON,
  DirectiveDefinitionNode,
  InputObjectTypeDefinitionNode,
  Kind,
  ScalarTypeDefinitionNode,
  TypeNode,
} from 'graphql';
import { stringArrayToNameNodeArray, stringToNamedTypeNode, stringToNameNode } from '../../ast/utils';
import {
  MutableDirectiveDefinitionNode,
  MutableEnumNode,
  MutableInputObjectNode,
  MutableScalarNode,
} from '../../schema-building/ast';
import { DEFAULT_CONSUMER_INACTIVE_THRESHOLD } from './integer-constants';
import {
  AND_UPPER,
  ARGUMENT_DEFINITION_UPPER,
  AS,
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  CHANNEL,
  CHANNELS,
  COMPOSE_DIRECTIVE,
  CONDITION,
  CONFIGURE_CHILD_DESCRIPTIONS,
  CONFIGURE_DESCRIPTION,
  CONSUMER_INACTIVE_THRESHOLD,
  CONSUMER_NAME,
  DEFAULT_EDFS_PROVIDER_ID,
  DEPRECATED,
  DESCRIPTION_OVERRIDE,
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_STREAM_CONFIGURATION,
  EDFS_NATS_SUBSCRIBE,
  EDFS_REDIS_PUBLISH,
  EDFS_REDIS_SUBSCRIBE,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXECUTION,
  EXTENDS,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELD_PATH,
  FIELD_SET_SCALAR,
  FIELDS,
  FLOAT_SCALAR,
  FOR,
  FROM,
  ID_SCALAR,
  IMPORT,
  IN_UPPER,
  INACCESSIBLE,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INT_SCALAR,
  INTERFACE_OBJECT,
  INTERFACE_UPPER,
  KEY,
  LEVELS,
  LINK,
  LINK_IMPORT,
  LINK_PURPOSE,
  NAME,
  NOT_UPPER,
  OBJECT_UPPER,
  ONE_OF,
  OR_UPPER,
  OVERRIDE,
  PROPAGATE,
  PROVIDER_ID,
  PROVIDES,
  REASON,
  REQUIRE_FETCH_REASONS,
  REQUIRES,
  REQUIRES_SCOPES,
  RESOLVABLE,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SCOPE_SCALAR,
  SCOPES,
  SECURITY,
  SEMANTIC_NON_NULL,
  SHAREABLE,
  SPECIFIED_BY,
  STREAM_CONFIGURATION,
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
} from '../../utils/string-constants';

export const REQUIRED_STRING_TYPE_NODE: TypeNode = {
  kind: Kind.NON_NULL_TYPE,
  type: stringToNamedTypeNode(STRING_SCALAR),
};

export const BASE_SCALARS = new Set<string>([
  '_Any',
  '_Entities',
  BOOLEAN_SCALAR,
  FLOAT_SCALAR,
  ID_SCALAR,
  INT_SCALAR,
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
export const EXTENDS_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([INTERFACE_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(EXTENDS),
  repeatable: false,
};

// directive @external on FIELD_DEFINITION | OBJECT
export const EXTERNAL_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(EXTERNAL),
  repeatable: false,
};

// directive @edfs__kafkaPublish(topic: String!, providerId: String! = "default") on FIELD_DEFINITION
export const EDFS_KAFKA_PUBLISH_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(TOPIC),
      type: REQUIRED_STRING_TYPE_NODE,
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: REQUIRED_STRING_TYPE_NODE,
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

// directive @edfs__kafkaSubscribe(topics: [String!]!, providerId: String! = "default") on FIELD_DEFINITION
export const EDFS_KAFKA_SUBSCRIBE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(TOPICS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: REQUIRED_STRING_TYPE_NODE,
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: REQUIRED_STRING_TYPE_NODE,
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_KAFKA_SUBSCRIBE),
  repeatable: false,
};

// directive @edfs__natsPublish(subject: String!, providerId: String! = "default") on FIELD_DEFINITION
export const EDFS_NATS_PUBLISH_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SUBJECT),
      type: REQUIRED_STRING_TYPE_NODE,
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
export const EDFS_NATS_REQUEST_DEFINITION: DirectiveDefinitionNode = {
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

/* directive @edfs__natsSubscribe(
 *   subjects: [String!]!, providerId: String! = "default",
 *   streamConfiguration: edfs__NatsStreamConfiguration
 * ) on FIELD_DEFINITION
 */
export const EDFS_NATS_SUBSCRIBE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(SUBJECTS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: REQUIRED_STRING_TYPE_NODE,
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: REQUIRED_STRING_TYPE_NODE,
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(STREAM_CONFIGURATION),
      type: stringToNamedTypeNode(EDFS_NATS_STREAM_CONFIGURATION),
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_NATS_SUBSCRIBE),
  repeatable: false,
};

export const REQUIRED_FIELDSET_TYPE_NODE: TypeNode = {
  kind: Kind.NON_NULL_TYPE,
  type: stringToNamedTypeNode(FIELD_SET_SCALAR),
};

// directive @key(fields: openfed__FieldSet!, resolvable: Boolean = true) repeatable on INTERFACE | OBJECT
export const KEY_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELDS),
      type: REQUIRED_FIELDSET_TYPE_NODE,
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
export const PROVIDES_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELDS),
      type: REQUIRED_FIELDSET_TYPE_NODE,
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(PROVIDES),
  repeatable: false,
};

// directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
export const REQUIRES_DEFINITION: DirectiveDefinitionNode = {
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
export const SPECIFIED_BY_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(URL_LOWER),
      type: REQUIRED_STRING_TYPE_NODE,
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

// directive @edfs__redisPublish(channel: String!, providerId: String! = "default") on FIELD_DEFINITION
export const EDFS_REDIS_PUBLISH_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CHANNEL),
      type: REQUIRED_STRING_TYPE_NODE,
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: REQUIRED_STRING_TYPE_NODE,
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_REDIS_PUBLISH),
  repeatable: false,
};

// directive @edfs__redisSubscribe(channels: [String!]!, providerId: String! = "default") on FIELD_DEFINITION
export const EDFS_REDIS_SUBSCRIBE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CHANNELS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: REQUIRED_STRING_TYPE_NODE,
        },
      },
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROVIDER_ID),
      type: REQUIRED_STRING_TYPE_NODE,
      defaultValue: {
        kind: Kind.STRING,
        value: DEFAULT_EDFS_PROVIDER_ID,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(EDFS_REDIS_SUBSCRIBE),
  repeatable: false,
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
  [EDFS_REDIS_PUBLISH, EDFS_REDIS_PUBLISH_DEFINITION],
  [EDFS_REDIS_SUBSCRIBE, EDFS_REDIS_SUBSCRIBE_DEFINITION],
  [KEY, KEY_DEFINITION],
  [PROVIDES, PROVIDES_DEFINITION],
  [REQUIRES, REQUIRES_DEFINITION],
  [SPECIFIED_BY, SPECIFIED_BY_DEFINITION],
  [TAG, TAG_DEFINITION],
]);

export const ALL_IN_BUILT_DIRECTIVE_NAMES = new Set<string>([
  AUTHENTICATED,
  COMPOSE_DIRECTIVE,
  CONFIGURE_DESCRIPTION,
  CONFIGURE_CHILD_DESCRIPTIONS,
  DEPRECATED,
  EDFS_NATS_PUBLISH,
  EDFS_NATS_REQUEST,
  EDFS_NATS_SUBSCRIBE,
  EDFS_KAFKA_PUBLISH,
  EDFS_KAFKA_SUBSCRIBE,
  EDFS_REDIS_PUBLISH,
  EDFS_REDIS_SUBSCRIBE,
  EXTENDS,
  EXTERNAL,
  INACCESSIBLE,
  INTERFACE_OBJECT,
  KEY,
  LINK,
  ONE_OF,
  OVERRIDE,
  PROVIDES,
  REQUIRE_FETCH_REASONS,
  REQUIRES,
  REQUIRES_SCOPES,
  SEMANTIC_NON_NULL,
  SHAREABLE,
  SPECIFIED_BY,
  SUBSCRIPTION_FILTER,
  TAG,
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
export const COMPOSE_DIRECTIVE_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(NAME),
      type: REQUIRED_STRING_TYPE_NODE,
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
export const INTERFACE_OBJECT_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([OBJECT_UPPER]),
  name: stringToNameNode(INTERFACE_OBJECT),
  repeatable: false,
};

export const LINK_IMPORT_DEFINITION: MutableScalarNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(LINK_IMPORT),
};

export const LINK_PURPOSE_DEFINITION: MutableEnumNode = {
  kind: Kind.ENUM_TYPE_DEFINITION,
  name: stringToNameNode(LINK_PURPOSE),
  values: [
    {
      directives: [],
      kind: Kind.ENUM_VALUE_DEFINITION,
      name: stringToNameNode(EXECUTION),
    },
    {
      directives: [],
      kind: Kind.ENUM_VALUE_DEFINITION,
      name: stringToNameNode(SECURITY),
    },
  ],
};

// directive @link(url: String!, as: String!, for: String, import: [String]) repeatable on SCHEMA
export const LINK_DEFINITION: DirectiveDefinitionNode = {
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
      name: stringToNameNode(AS),
      type: stringToNamedTypeNode(STRING_SCALAR),
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FOR),
      type: stringToNamedTypeNode(LINK_PURPOSE),
    },
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(IMPORT),
      type: {
        kind: Kind.LIST_TYPE,
        type: stringToNamedTypeNode(LINK_IMPORT),
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([SCHEMA_UPPER]),
  name: stringToNameNode(LINK),
  repeatable: true,
};

// directive @oneOf on INPUT_OBJECT
export const ONE_OF_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([INPUT_OBJECT_UPPER]),
  name: stringToNameNode(ONE_OF),
  repeatable: false,
};

// directive @override(from: String!) on FIELD_DEFINITION
export const OVERRIDE_DEFINITION: DirectiveDefinitionNode = {
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

// directive @openfed__requireFetchReasons repeatable on FIELD_DEFINITION | OBJECT
export const REQUIRE_FETCH_REASONS_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(REQUIRE_FETCH_REASONS),
  repeatable: true,
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

// directive @semanticNonNull(levels: [Int!]! = [0]) on FIELD_DEFINITION
export const SEMANTIC_NON_NULL_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(LEVELS),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: {
          kind: Kind.LIST_TYPE,
          type: {
            kind: Kind.NON_NULL_TYPE,
            type: stringToNamedTypeNode(INT_SCALAR),
          },
        },
      },
      defaultValue: {
        kind: Kind.LIST,
        values: [
          {
            kind: Kind.INT,
            value: '0',
          },
        ],
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(SEMANTIC_NON_NULL),
  repeatable: false,
};

// directive @shareable on FIELD_DEFINITION | OBJECT
export const SHAREABLE_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(SHAREABLE),
  repeatable: true,
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
  [EDFS_REDIS_PUBLISH, EDFS_REDIS_PUBLISH_DEFINITION],
  [EDFS_REDIS_SUBSCRIBE, EDFS_REDIS_SUBSCRIBE_DEFINITION],
]);

export const VERSION_TWO_DIRECTIVE_DEFINITIONS: DirectiveDefinitionNode[] = [
  AUTHENTICATED_DEFINITION,
  COMPOSE_DIRECTIVE_DEFINITION,
  INACCESSIBLE_DEFINITION,
  INTERFACE_OBJECT_DEFINITION,
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
 *   consumerInactiveThreshold : Int! = 30
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
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CONSUMER_INACTIVE_THRESHOLD),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(INT_SCALAR),
      },
      defaultValue: {
        kind: Kind.INT,
        value: DEFAULT_CONSUMER_INACTIVE_THRESHOLD.toString(),
      },
    },
  ],
};

/*
 * directive @openfed__configureDescription(
 *   propagate: Boolean! = true
 *   descriptionOverride: String
 * ) on ARGUMENT_DEFINITION | FIELD_DEFINITION | INPUT_OBJECT | INPUT_FIELD_DEFINITION | ENUM | ENUM_VALUE |
 * INTERFACE | OBJECT | SCALAR | SCHEMA | UNION
 * */
export const CONFIGURE_DESCRIPTION_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROPAGATE),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      },
      defaultValue: {
        kind: Kind.BOOLEAN,
        value: true,
      },
    },
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(DESCRIPTION_OVERRIDE),
      type: stringToNamedTypeNode(STRING_SCALAR),
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_UPPER,
    ENUM_VALUE_UPPER,
    FIELD_DEFINITION_UPPER,
    INTERFACE_UPPER,
    INPUT_OBJECT_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
    SCHEMA_UPPER,
    UNION_UPPER,
  ]),
  name: stringToNameNode(CONFIGURE_DESCRIPTION),
  repeatable: false,
};

/*
 * directive @openfed__configureChildDescriptions(
 *   propagate: Boolean! = true
 * ) on ENUM | INPUT_OBJECT | INTERFACE | OBJECT
 */
export const CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION: MutableDirectiveDefinitionNode = {
  arguments: [
    {
      directives: [],
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(PROPAGATE),
      type: {
        kind: Kind.NON_NULL_TYPE,
        type: stringToNamedTypeNode(BOOLEAN_SCALAR),
      },
      defaultValue: {
        kind: Kind.BOOLEAN,
        value: true,
      },
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([ENUM_UPPER, INPUT_OBJECT_UPPER, INTERFACE_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(CONFIGURE_CHILD_DESCRIPTIONS),
  repeatable: false,
};

export const EDFS_ARGS_REGEXP = /{{\s*args\.([a-zA-Z0-9_]+)\s*}}/g;

export const MAX_OR_SCOPES = 16;
