/* directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE |
 FIELD_DEFINITION | INPUT_FIELD_DEFINITION
*/
import { DEFAULT_DEPRECATION_REASON, DirectiveDefinitionNode, Kind } from 'graphql';
import { stringArrayToNameNodeArray, stringToNamedTypeNode, stringToNameNode } from '../../ast/utils';
import {
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
  CONNECT_CONFIGURE_RESOLVER,
  CONTEXT,
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
  EXTENDS,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELDS,
  FOR,
  FROM,
  IMPORT,
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
  OBJECT_UPPER,
  ONE_OF,
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
  SEMANTIC_NON_NULL,
  SHAREABLE,
  SPECIFIED_BY,
  STREAM_CONFIGURATION,
  STRING_SCALAR,
  SUBJECT,
  SUBJECTS,
  SUBSCRIPTION_FILTER,
  SUBSCRIPTION_FILTER_CONDITION,
  TAG,
  TOPIC,
  TOPICS,
  UNION_UPPER,
  URL_LOWER,
} from '../../utils/string-constants';
import { REQUIRED_FIELDSET_TYPE_NODE, REQUIRED_STRING_TYPE_NODE } from './type-nodes';

// @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
export const AUTHENTICATED_DEFINITION: DirectiveDefinitionNode = {
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

/*
 * directive @openfed__configureChildDescriptions(
 *   propagate: Boolean! = true
 * ) on ENUM | INPUT_OBJECT | INTERFACE | OBJECT
 */
export const CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
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

/*
 * directive @openfed__configureDescription(
 *   propagate: Boolean! = true
 *   descriptionOverride: String
 * ) on ARGUMENT_DEFINITION | FIELD_DEFINITION | INPUT_OBJECT | INPUT_FIELD_DEFINITION | ENUM | ENUM_VALUE |
 * INTERFACE | OBJECT | SCALAR | SCHEMA | UNION
 * */
export const CONFIGURE_DESCRIPTION_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
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

// directive @connect__fieldResolver(context: openfed__FieldSet!) on FIELD_DEFINITION
export const CONNECT_CONFIGURE_RESOLVER_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(CONTEXT),
      type: REQUIRED_FIELDSET_TYPE_NODE,
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
  name: stringToNameNode(CONNECT_CONFIGURE_RESOLVER),
  repeatable: false,
};

export const DEPRECATED_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
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

// directive @edfs__natsRequest(subject: String!, providerId: String! = "default") on FIELD_DEFINITION
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

export const INACCESSIBLE_DEFINITION: DirectiveDefinitionNode = {
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

// directive @openfed__requireFetchReasons repeatable on FIELD_DEFINITION | INTERFACE | OBJECT
export const REQUIRE_FETCH_REASONS_DEFINITION: DirectiveDefinitionNode = {
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, INTERFACE_UPPER, OBJECT_UPPER]),
  name: stringToNameNode(REQUIRE_FETCH_REASONS),
  repeatable: true,
};

// directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
export const REQUIRES_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
      kind: Kind.INPUT_VALUE_DEFINITION,
      name: stringToNameNode(FIELDS),
      type: REQUIRED_FIELDSET_TYPE_NODE,
    },
  ],
  kind: Kind.DIRECTIVE_DEFINITION,
  locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
  name: stringToNameNode(REQUIRES),
  repeatable: false,
};

// @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
export const REQUIRES_SCOPES_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
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
export const SEMANTIC_NON_NULL_DEFINITION: DirectiveDefinitionNode = {
  arguments: [
    {
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

/* directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION
  | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
*/
export const TAG_DEFINITION: DirectiveDefinitionNode = {
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
