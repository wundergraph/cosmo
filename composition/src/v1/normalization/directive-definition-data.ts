import { ArgumentData, DirectiveDefinitionData } from '../../schema-building/types';
import {
  AUTHENTICATED_DEFINITION,
  COMPOSE_DIRECTIVE_DEFINITION,
  CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
  CONFIGURE_DESCRIPTION_DEFINITION,
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
  ONE_OF_DEFINITION,
  OVERRIDE_DEFINITION,
  PROVIDES_DEFINITION,
  REQUIRE_FETCH_REASONS_DEFINITION,
  REQUIRED_FIELDSET_TYPE_NODE,
  REQUIRED_STRING_TYPE_NODE,
  REQUIRES_DEFINITION,
  REQUIRES_SCOPES_DEFINITION,
  SEMANTIC_NON_NULL_DEFINITION,
  SHAREABLE_DEFINITION,
  SPECIFIED_BY_DEFINITION,
  SUBSCRIPTION_FILTER_DEFINITION,
  TAG_DEFINITION,
} from '../utils/constants';
import { stringToNamedTypeNode } from '../../ast/utils';
import { DEFAULT_DEPRECATION_REASON, Kind } from 'graphql';
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

export const AUTHENTICATED_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([]),
  isRepeatable: false,
  locations: new Set<string>([ENUM_UPPER, FIELD_DEFINITION_UPPER, INTERFACE_UPPER, OBJECT_UPPER, SCALAR_UPPER]),
  name: AUTHENTICATED,
  node: AUTHENTICATED_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const COMPOSE_DIRECTIVE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      NAME,
      {
        name: NAME,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
  ]),
  isRepeatable: true,
  locations: new Set<string>([SCHEMA_UPPER]),
  name: COMPOSE_DIRECTIVE,
  node: COMPOSE_DIRECTIVE_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([NAME]),
};

export const CONFIGURE_DESCRIPTION_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      PROPAGATE,
      {
        name: PROPAGATE,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(BOOLEAN_SCALAR),
        },
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
      },
    ],
    [
      DESCRIPTION_OVERRIDE,
      {
        name: DESCRIPTION_OVERRIDE,
        typeNode: stringToNamedTypeNode(STRING_SCALAR),
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([
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
  optionalArgumentNames: new Set<string>([PROPAGATE, DESCRIPTION_OVERRIDE]),
  requiredArgumentNames: new Set<string>(),
};

export const CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      PROPAGATE,
      {
        name: PROPAGATE,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(BOOLEAN_SCALAR),
        },
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([ENUM_UPPER, INPUT_OBJECT_UPPER, INTERFACE_UPPER, OBJECT_UPPER]),
  name: CONFIGURE_CHILD_DESCRIPTIONS,
  node: CONFIGURE_CHILD_DESCRIPTIONS_DEFINITION,
  optionalArgumentNames: new Set<string>([PROPAGATE]),
  requiredArgumentNames: new Set<string>(),
};

export const DEPRECATED_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      REASON,
      {
        name: REASON,
        typeNode: stringToNamedTypeNode(STRING_SCALAR),
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_DEPRECATION_REASON,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([
    ARGUMENT_DEFINITION_UPPER,
    ENUM_VALUE_UPPER,
    FIELD_DEFINITION_UPPER,
    INPUT_FIELD_DEFINITION_UPPER,
  ]),
  name: DEPRECATED,
  node: DEPRECATED_DEFINITION,
  optionalArgumentNames: new Set<string>([REASON]),
  requiredArgumentNames: new Set<string>(),
};

export const EXTENDS_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>(),
  isRepeatable: false,
  locations: new Set<string>([INTERFACE_UPPER, OBJECT_UPPER]),
  name: EXTENDS,
  node: EXTENDS_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const EXTERNAL_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>(),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: EXTERNAL,
  node: EXTERNAL_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const INACCESSIBLE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>(),
  isRepeatable: false,
  locations: new Set<string>([
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
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const INTERFACE_OBJECT_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>(),
  isRepeatable: false,
  locations: new Set<string>([OBJECT_UPPER]),
  name: INTERFACE_OBJECT,
  node: INTERFACE_OBJECT_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const KAFKA_PUBLISH_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      TOPIC,
      {
        name: TOPIC,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_KAFKA_PUBLISH,
  node: EDFS_KAFKA_PUBLISH_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([TOPIC]),
};

export const KAFKA_SUBSCRIBE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      TOPICS,
      {
        name: TOPICS,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: REQUIRED_STRING_TYPE_NODE,
          },
        },
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_KAFKA_SUBSCRIBE,
  node: EDFS_KAFKA_SUBSCRIBE_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([TOPICS]),
};

export const NATS_PUBLISH_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      SUBJECT,
      {
        name: SUBJECT,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_NATS_PUBLISH,
  node: EDFS_NATS_PUBLISH_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([SUBJECT]),
};

export const NATS_REQUEST_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      SUBJECT,
      {
        name: SUBJECT,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_NATS_REQUEST,
  node: EDFS_NATS_REQUEST_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([SUBJECT]),
};

export const NATS_SUBSCRIBE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      SUBJECTS,
      {
        name: SUBJECTS,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: REQUIRED_STRING_TYPE_NODE,
          },
        },
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
    [
      STREAM_CONFIGURATION,
      {
        name: STREAM_CONFIGURATION,
        typeNode: stringToNamedTypeNode(EDFS_NATS_STREAM_CONFIGURATION),
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_NATS_SUBSCRIBE,
  node: EDFS_NATS_SUBSCRIBE_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([SUBJECTS]),
};

export const ONE_OF_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([]),
  isRepeatable: false,
  locations: new Set<string>([INPUT_OBJECT_UPPER]),
  name: ONE_OF,
  node: ONE_OF_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const OVERRIDE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      FROM,
      {
        name: FROM,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: OVERRIDE,
  node: OVERRIDE_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([FROM]),
};

export const KEY_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      FIELDS,
      {
        name: FIELDS,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      },
    ],
    [
      RESOLVABLE,
      {
        name: RESOLVABLE,
        typeNode: stringToNamedTypeNode(BOOLEAN_SCALAR),
        defaultValue: {
          kind: Kind.BOOLEAN,
          value: true,
        },
      },
    ],
  ]),
  isRepeatable: true,
  locations: new Set<string>([INTERFACE_UPPER, OBJECT_UPPER]),
  name: KEY,
  node: KEY_DEFINITION,
  optionalArgumentNames: new Set<string>([RESOLVABLE]),
  requiredArgumentNames: new Set<string>([FIELDS]),
};

export const LINK_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      URL_LOWER,
      {
        name: URL_LOWER,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
    [
      AS,
      {
        name: AS,
        typeNode: stringToNamedTypeNode(STRING_SCALAR),
      },
    ],
    [
      FOR,
      {
        name: FOR,
        typeNode: stringToNamedTypeNode(LINK_PURPOSE),
      },
    ],
    [
      IMPORT,
      {
        name: IMPORT,
        typeNode: {
          kind: Kind.LIST_TYPE,
          type: stringToNamedTypeNode(LINK_IMPORT),
        },
      },
    ],
  ]),
  isRepeatable: true,
  locations: new Set<string>([SCHEMA_UPPER]),
  name: LINK,
  node: LINK_DEFINITION,
  optionalArgumentNames: new Set<string>([AS, FOR, IMPORT]),
  requiredArgumentNames: new Set<string>([URL_LOWER]),
};

export const PROVIDES_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      FIELDS,
      {
        name: FIELDS,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: PROVIDES,
  node: PROVIDES_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([FIELDS]),
};

export const REQUIRES_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      FIELDS,
      {
        name: FIELDS,
        typeNode: REQUIRED_FIELDSET_TYPE_NODE,
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: REQUIRES,
  node: REQUIRES_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([FIELDS]),
};

export const REDIS_PUBLISH_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      CHANNEL,
      {
        name: CHANNEL,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_REDIS_PUBLISH,
  node: EDFS_REDIS_PUBLISH_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([CHANNEL]),
};

export const REDIS_SUBSCRIBE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      CHANNELS,
      {
        name: CHANNELS,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: {
            kind: Kind.LIST_TYPE,
            type: REQUIRED_STRING_TYPE_NODE,
          },
        },
      },
    ],
    [
      PROVIDER_ID,
      {
        name: PROVIDER_ID,
        typeNode: REQUIRED_STRING_TYPE_NODE,
        defaultValue: {
          kind: Kind.STRING,
          value: DEFAULT_EDFS_PROVIDER_ID,
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: EDFS_REDIS_SUBSCRIBE,
  node: EDFS_REDIS_SUBSCRIBE_DEFINITION,
  optionalArgumentNames: new Set<string>([PROVIDER_ID]),
  requiredArgumentNames: new Set<string>([CHANNELS]),
};

export const REQUIRE_FETCH_REASONS_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>(),
  isRepeatable: true,
  locations: new Set<string>([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: REQUIRE_FETCH_REASONS,
  node: REQUIRE_FETCH_REASONS_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const REQUIRES_SCOPES_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      SCOPES,
      {
        name: SCOPES,
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
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([ENUM_UPPER, FIELD_DEFINITION_UPPER, INTERFACE_UPPER, OBJECT_UPPER, SCALAR_UPPER]),
  name: REQUIRES_SCOPES,
  node: REQUIRES_SCOPES_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([SCOPES]),
};

export const SEMANTIC_NON_NULL_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      LEVELS,
      {
        name: LEVELS,
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
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: SEMANTIC_NON_NULL,
  node: SEMANTIC_NON_NULL_DEFINITION,
  optionalArgumentNames: new Set<string>([LEVELS]),
  requiredArgumentNames: new Set<string>(),
};

export const SPECIFIED_BY_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      URL_LOWER,
      {
        name: URL_LOWER,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([SCALAR_UPPER]),
  name: SPECIFIED_BY,
  node: SPECIFIED_BY_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([URL_LOWER]),
};

export const SHAREABLE_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>(),
  isRepeatable: true,
  locations: new Set<string>([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
  name: SHAREABLE,
  node: SHAREABLE_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>(),
};

export const SUBSCRIPTION_FILTER_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      CONDITION,
      {
        name: CONDITION,
        typeNode: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(SUBSCRIPTION_FILTER_CONDITION),
        },
      },
    ],
  ]),
  isRepeatable: false,
  locations: new Set<string>([FIELD_DEFINITION_UPPER]),
  name: SUBSCRIPTION_FILTER,
  node: SUBSCRIPTION_FILTER_DEFINITION,
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([CONDITION]),
};

export const TAG_DEFINITION_DATA: DirectiveDefinitionData = {
  argumentTypeNodeByArgumentName: new Map<string, ArgumentData>([
    [
      NAME,
      {
        name: NAME,
        typeNode: REQUIRED_STRING_TYPE_NODE,
      },
    ],
  ]),
  isRepeatable: true,
  locations: new Set<string>([
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
  optionalArgumentNames: new Set<string>(),
  requiredArgumentNames: new Set<string>([NAME]),
};
