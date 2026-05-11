import { stringToNamedTypeNode } from '../ast/utils';
import { DEFAULT_DEPRECATION_REASON, Kind } from 'graphql';
import {
  ARGUMENT_DEFINITION_UPPER,
  AS,
  ASSUMED_SIZE,
  AUTHENTICATED,
  BOOLEAN_SCALAR,
  CHANNEL,
  CHANNELS,
  COMPOSE_DIRECTIVE,
  CONDITION,
  CONFIGURE_CHILD_DESCRIPTIONS,
  CONFIGURE_DESCRIPTION,
  CONNECT_FIELD_RESOLVER,
  CONTEXT,
  COST,
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
  LIST_SIZE,
  NAME,
  OBJECT_UPPER,
  ONE_OF,
  OVERRIDE,
  PROPAGATE,
  PROVIDER_ID,
  PROVIDES,
  REASON,
  REQUIRE_FETCH_REASONS,
  REQUIRE_ONE_SLICING_ARGUMENT,
  REQUIRES,
  REQUIRES_SCOPES,
  RESOLVABLE,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SCOPE_SCALAR,
  SCOPES,
  SEMANTIC_NON_NULL,
  SHAREABLE,
  SIZED_FIELDS,
  SLICING_ARGUMENTS,
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
  WEIGHT,
} from '../utils/string-constants';
import {
  AUTHENTICATED_DEFINITION,
  COMPOSE_DIRECTIVE_DEFINITION,
  CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
  CONFIGURE_DESCRIPTION_DEFINITION,
  CONNECT_FIELD_RESOLVER_DEFINITION,
  COST_DEFINITION,
  DEPRECATED_DEFINITION,
  EDFS_KAFKA_PUBLISH_DEFINITION,
  EDFS_KAFKA_SUBSCRIBE_DEFINITION,
  EDFS_NATS_PUBLISH_DEFINITION,
  EDFS_NATS_REQUEST_DEFINITION,
  EDFS_NATS_SUBSCRIBE_DEFINITION,
  EDFS_REDIS_PUBLISH_DEFINITION,
  EDFS_REDIS_SUBSCRIBE_DEFINITION,
  EXTENDS_DEFINITION,
  EXTERNAL_DEFINITION,
  INACCESSIBLE_DEFINITION,
  INTERFACE_OBJECT_DEFINITION,
  KEY_DEFINITION,
  LINK_DEFINITION,
  LIST_SIZE_DEFINITION,
  ONE_OF_DEFINITION,
  OVERRIDE_DEFINITION,
  PROVIDES_DEFINITION,
  REQUIRE_FETCH_REASONS_DEFINITION,
  REQUIRES_DEFINITION,
  REQUIRES_SCOPES_DEFINITION,
  SEMANTIC_NON_NULL_DEFINITION,
  SHAREABLE_DEFINITION,
  SPECIFIED_BY_DEFINITION,
  SUBSCRIPTION_FILTER_DEFINITION,
  TAG_DEFINITION,
} from '../v1/constants/directive-definitions';
import { REQUIRED_FIELDSET_TYPE_NODE, REQUIRED_STRING_TYPE_NODE } from '../v1/constants/type-nodes';
import { type ArgumentName, type DirectiveLocation } from '../types/types';
import { newDirectiveArgumentData, newDirectiveDefinitionData } from './utils';
import { type DirectiveArgumentData, DirectiveDefinitionData } from './types/types';

// Note that arguments with default values are classed as optional and should be placed into `optionalArgumentNames`.

export const AUTHENTICATED_DEFINITION_DATA = newDirectiveDefinitionData({
  locations: new Set<DirectiveLocation>([
    ENUM_UPPER,
    FIELD_DEFINITION_UPPER,
    INTERFACE_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
  ]),
  name: AUTHENTICATED,
  node: AUTHENTICATED_DEFINITION,
});

export const COMPOSE_DIRECTIVE_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      NAME,
      newDirectiveArgumentData({
        directive: `@${COMPOSE_DIRECTIVE}`,
        name: NAME,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  isRepeatable: true,
  locations: new Set<DirectiveLocation>([SCHEMA_UPPER]),
  name: COMPOSE_DIRECTIVE,
  node: COMPOSE_DIRECTIVE_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([NAME]),
});

export const CONFIGURE_DESCRIPTION_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      PROPAGATE,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
        directive: `@${CONFIGURE_DESCRIPTION}`,
        name: PROPAGATE,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(BOOLEAN_SCALAR),
        },
      }),
    ],
    [
      DESCRIPTION_OVERRIDE,
      newDirectiveArgumentData({
        directive: `@${CONFIGURE_DESCRIPTION}`,
        name: DESCRIPTION_OVERRIDE,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(STRING_SCALAR),
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([
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
  name: CONFIGURE_DESCRIPTION,
  node: CONFIGURE_DESCRIPTION_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROPAGATE, DESCRIPTION_OVERRIDE]),
});

export const CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      PROPAGATE,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
        directive: `@${CONFIGURE_CHILD_DESCRIPTIONS}`,
        name: PROPAGATE,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(BOOLEAN_SCALAR),
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([ENUM_UPPER, INPUT_OBJECT_UPPER, INTERFACE_UPPER, OBJECT_UPPER]),
  name: CONFIGURE_CHILD_DESCRIPTIONS,
  node: CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROPAGATE]),
});

export const CONNECT_FIELD_RESOLVER_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      CONTEXT,
      newDirectiveArgumentData({
        directive: `@${CONNECT_FIELD_RESOLVER}`,
        name: CONTEXT,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: CONNECT_FIELD_RESOLVER,
  node: CONNECT_FIELD_RESOLVER_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([CONTEXT]),
});

export const COST_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      WEIGHT,
      newDirectiveArgumentData({
        directive: `@${COST}`,
        name: WEIGHT,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(INT_SCALAR),
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_UPPER,
    FIELD_DEFINITION_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
  ]),
  name: COST,
  node: COST_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([WEIGHT]),
});

export const DEPRECATED_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      REASON,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_DEPRECATION_REASON,
        },
        directive: `@${DEPRECATED}`,
        name: REASON,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(STRING_SCALAR),
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_VALUE_UPPER,
    FIELD_DEFINITION_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
  ]),
  name: DEPRECATED,
  node: DEPRECATED_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([REASON]),
});

export const EXTENDS_DEFINITION_DATA = newDirectiveDefinitionData({
  locations: new Set<DirectiveLocation>([INTERFACE_UPPER, OBJECT_UPPER]),
  name: EXTENDS,
  node: EXTENDS_DEFINITION,
});

export const EXTERNAL_DEFINITION_DATA = newDirectiveDefinitionData({
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: EXTERNAL,
  node: EXTERNAL_DEFINITION,
});

export const INACCESSIBLE_DEFINITION_DATA = newDirectiveDefinitionData({
  locations: new Set<DirectiveLocation>([
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
  name: INACCESSIBLE,
  node: INACCESSIBLE_DEFINITION,
});

export const INTERFACE_OBJECT_DEFINITION_DATA = newDirectiveDefinitionData({
  locations: new Set<DirectiveLocation>([OBJECT_UPPER]),
  name: INTERFACE_OBJECT,
  node: INTERFACE_OBJECT_DEFINITION,
});

export const KAFKA_PUBLISH_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      TOPIC,
      newDirectiveArgumentData({
        directive: `@${EDFS_KAFKA_PUBLISH}`,
        name: TOPIC,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
        directive: `@${EDFS_KAFKA_PUBLISH}`,
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_KAFKA_PUBLISH,
  node: EDFS_KAFKA_PUBLISH_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID]),
  requiredArgumentNames: new Set<ArgumentName>([TOPIC]),
});

export const KAFKA_SUBSCRIBE_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      TOPICS,
      newDirectiveArgumentData({
        directive: `@${EDFS_KAFKA_SUBSCRIBE}`,
        name: TOPICS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: REQUIRED_STRING_TYPE_NODE,
          },
        },
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        directive: `@${EDFS_KAFKA_SUBSCRIBE}`,
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_KAFKA_SUBSCRIBE,
  node: EDFS_KAFKA_SUBSCRIBE_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID]),
  requiredArgumentNames: new Set<ArgumentName>([TOPICS]),
});

export const NATS_PUBLISH_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      SUBJECT,
      newDirectiveArgumentData({
        directive: `@${EDFS_NATS_PUBLISH}`,
        name: SUBJECT,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
        directive: `@${EDFS_NATS_PUBLISH}`,
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  isComposed: true,
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_NATS_PUBLISH,
  node: EDFS_NATS_PUBLISH_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID]),
  requiredArgumentNames: new Set<ArgumentName>([SUBJECT]),
});

export const NATS_REQUEST_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      SUBJECT,
      newDirectiveArgumentData({
        directive: `@${EDFS_NATS_REQUEST}`,
        name: SUBJECT,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
        directive: `@${EDFS_NATS_REQUEST}`,
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_NATS_REQUEST,
  node: EDFS_NATS_REQUEST_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID]),
  requiredArgumentNames: new Set<ArgumentName>([SUBJECT]),
});

export const NATS_SUBSCRIBE_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      SUBJECTS,
      newDirectiveArgumentData({
        directive: `@${EDFS_NATS_SUBSCRIBE}`,
        name: SUBJECTS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: REQUIRED_STRING_TYPE_NODE,
          },
        },
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        directive: `@${EDFS_NATS_SUBSCRIBE}`,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
    [
      STREAM_CONFIGURATION,
      newDirectiveArgumentData({
        directive: `@${EDFS_NATS_SUBSCRIBE}`,
        name: STREAM_CONFIGURATION,
        namedTypeKind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(EDFS_NATS_STREAM_CONFIGURATION),
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_NATS_SUBSCRIBE,
  node: EDFS_NATS_SUBSCRIBE_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID, STREAM_CONFIGURATION]),
  requiredArgumentNames: new Set<ArgumentName>([SUBJECTS]),
});

export const ONE_OF_DEFINITION_DATA = newDirectiveDefinitionData({
  locations: new Set<DirectiveLocation>([INPUT_OBJECT_UPPER]),
  name: ONE_OF,
  node: ONE_OF_DEFINITION,
});

export const OVERRIDE_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      FROM,
      newDirectiveArgumentData({
        directive: `@${OVERRIDE}`,
        name: FROM,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: OVERRIDE,
  node: OVERRIDE_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([FROM]),
});

export const KEY_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      FIELDS,
      newDirectiveArgumentData({
        directive: `@${KEY}`,
        name: FIELDS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      }),
    ],
    [
      RESOLVABLE,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
        directive: `@${KEY}`,
        name: RESOLVABLE,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR),
      }),
    ],
  ]),
  isRepeatable: true,
  locations: new Set<DirectiveLocation>([INTERFACE_UPPER, OBJECT_UPPER]),
  name: KEY,
  node: KEY_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([RESOLVABLE]),
  requiredArgumentNames: new Set<ArgumentName>([FIELDS]),
});

export const LINK_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      URL_LOWER,
      newDirectiveArgumentData({
        directive: `@${LINK}`,
        name: URL_LOWER,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
    [
      AS,
      newDirectiveArgumentData({
        directive: `@${LINK}`,
        name: AS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(STRING_SCALAR),
      }),
    ],
    [
      FOR,
      newDirectiveArgumentData({
        directive: `@${LINK}`,
        name: FOR,
        namedTypeKind: Kind.ENUM_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(LINK_PURPOSE),
      }),
    ],
    [
      IMPORT,
      newDirectiveArgumentData({
        directive: `@${LINK}`,
        name: IMPORT,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.LIST_TYPE,
          type: stringToNamedTypeNode(LINK_IMPORT),
        },
      }),
    ],
  ]),
  isRepeatable: true,
  locations: new Set<DirectiveLocation>([SCHEMA_UPPER]),
  name: LINK,
  node: LINK_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([AS, FOR, IMPORT]),
  requiredArgumentNames: new Set<ArgumentName>([URL_LOWER]),
});

export const LIST_SIZE_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      ASSUMED_SIZE,
      newDirectiveArgumentData({
        directive: `@${LIST_SIZE}`,
        name: ASSUMED_SIZE,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(INT_SCALAR),
      }),
    ],
    [
      SLICING_ARGUMENTS,
      newDirectiveArgumentData({
        directive: `@${LIST_SIZE}`,
        name: SLICING_ARGUMENTS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.LIST_TYPE,
          type: REQUIRED_STRING_TYPE_NODE,
        },
      }),
    ],
    [
      SIZED_FIELDS,
      newDirectiveArgumentData({
        directive: `@${LIST_SIZE}`,
        name: SIZED_FIELDS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.LIST_TYPE,
          type: REQUIRED_STRING_TYPE_NODE,
        },
      }),
    ],
    [
      REQUIRE_ONE_SLICING_ARGUMENT,
      newDirectiveArgumentData({
        directive: `@${LIST_SIZE}`,
        name: REQUIRE_ONE_SLICING_ARGUMENT,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR),
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: LIST_SIZE,
  node: LIST_SIZE_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([
    ASSUMED_SIZE,
    SLICING_ARGUMENTS,
    SIZED_FIELDS,
    REQUIRE_ONE_SLICING_ARGUMENT,
  ]),
});

export const PROVIDES_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      FIELDS,
      newDirectiveArgumentData({
        directive: `@${PROVIDES}`,
        name: FIELDS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: PROVIDES,
  node: PROVIDES_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([FIELDS]),
});

export const REQUIRES_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      FIELDS,
      newDirectiveArgumentData({
        directive: `@${REQUIRES}`,
        name: FIELDS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: REQUIRES,
  node: REQUIRES_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([FIELDS]),
});

export const REDIS_PUBLISH_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      CHANNEL,
      newDirectiveArgumentData({
        directive: `@${EDFS_REDIS_PUBLISH}`,
        name: CHANNEL,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
        directive: `@${EDFS_REDIS_PUBLISH}`,
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_REDIS_PUBLISH,
  node: EDFS_REDIS_PUBLISH_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID]),
  requiredArgumentNames: new Set<ArgumentName>([CHANNEL]),
});

export const REDIS_SUBSCRIBE_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      CHANNELS,
      newDirectiveArgumentData({
        directive: `@${EDFS_REDIS_SUBSCRIBE}`,
        name: CHANNELS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: REQUIRED_STRING_TYPE_NODE,
          },
        },
      }),
    ],
    [
      PROVIDER_ID,
      newDirectiveArgumentData({
        directive: `@${EDFS_REDIS_SUBSCRIBE}`,
        name: PROVIDER_ID,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: EDFS_REDIS_SUBSCRIBE,
  node: EDFS_REDIS_SUBSCRIBE_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([PROVIDER_ID]),
  requiredArgumentNames: new Set<ArgumentName>([CHANNELS]),
});

export const REQUIRE_FETCH_REASONS_DEFINITION_DATA = newDirectiveDefinitionData({
  isRepeatable: true,
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER, INTERFACE_UPPER, OBJECT_UPPER]),
  name: REQUIRE_FETCH_REASONS,
  node: REQUIRE_FETCH_REASONS_DEFINITION,
});

export const REQUIRES_SCOPES_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      SCOPES,
      newDirectiveArgumentData({
        directive: `@${REQUIRES_SCOPES}`,
        name: SCOPES,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
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
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([
    ENUM_UPPER,
    FIELD_DEFINITION_UPPER,
    INTERFACE_UPPER,
    OBJECT_UPPER,
    SCALAR_UPPER,
  ]),
  name: REQUIRES_SCOPES,
  node: REQUIRES_SCOPES_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([SCOPES]),
});

export const SEMANTIC_NON_NULL_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      LEVELS,
      newDirectiveArgumentData({
        defaultValue: {
          kind: Kind.LIST,
          values: [
            {
              kind: Kind.INT,
              value: '0',
            },
          ],
        },
        directive: `@${SEMANTIC_NON_NULL}`,
        name: LEVELS,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: {
              kind: Kind.NON_NULL_TYPE,
              type: stringToNamedTypeNode(INT_SCALAR),
            },
          },
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: SEMANTIC_NON_NULL,
  node: SEMANTIC_NON_NULL_DEFINITION,
  optionalArgumentNames: new Set<ArgumentName>([LEVELS]),
});

export const SPECIFIED_BY_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      URL_LOWER,
      newDirectiveArgumentData({
        directive: `@${SPECIFIED_BY}`,
        name: URL_LOWER,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([SCALAR_UPPER]),
  name: SPECIFIED_BY,
  node: SPECIFIED_BY_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([URL_LOWER]),
});

export const SHAREABLE_DEFINITION_DATA = newDirectiveDefinitionData({
  isRepeatable: true,
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: SHAREABLE,
  node: SHAREABLE_DEFINITION,
});

export const SUBSCRIPTION_FILTER_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      CONDITION,
      newDirectiveArgumentData({
        directive: `@${SUBSCRIPTION_FILTER}`,
        name: CONDITION,
        namedTypeKind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
        },
      }),
    ],
  ]),
  locations: new Set<DirectiveLocation>([FIELD_DEFINITION_UPPER]),
  name: SUBSCRIPTION_FILTER,
  node: SUBSCRIPTION_FILTER_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([CONDITION]),
});

export const TAG_DEFINITION_DATA = newDirectiveDefinitionData({
  argumentDataByName: new Map<ArgumentName, DirectiveArgumentData>([
    [
      NAME,
      newDirectiveArgumentData({
        directive: `@${TAG}`,
        name: NAME,
        namedTypeKind: Kind.SCALAR_TYPE_DEFINITION,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      }),
    ],
  ]),
  isRepeatable: true,
  locations: new Set<DirectiveLocation>([
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
  name: TAG,
  node: TAG_DEFINITION,
  requiredArgumentNames: new Set<ArgumentName>([NAME]),
});
