import { DirectiveDefinitionNode, Kind, ScalarTypeDefinitionNode } from 'graphql';
import { stringArrayToNameNodeArray, stringToNamedTypeNode, stringToNameNode } from '../ast/utils';
import {
  ARGUMENT_DEFINITION_UPPER,
  AUTHENTICATED,
  BOOLEAN_TYPE,
  COMPOSE_DIRECTIVE,
  DEPRECATED,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EVENTS_PUBLISH,
  EVENTS_REQUEST,
  EVENTS_SUBSCRIBE,
  EXTENDS,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELD_SET_SCALAR,
  FIELDS,
  FROM,
  INACCESSIBLE,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_OBJECT,
  INTERFACE_UPPER,
  KEY,
  LINK,
  NAME,
  OBJECT_UPPER,
  OVERRIDE,
  PROVIDES, REASON,
  REQUIRES,
  REQUIRES_SCOPES,
  RESOLVABLE,
  SCALAR_UPPER,
  SCHEMA_UPPER,
  SCOPES,
  SCOPE_SCALAR,
  SHAREABLE,
  SOURCE_ID,
  SPECIFIED_BY,
  STRING_SCALAR,
  TAG,
  TOPIC,
  UNION_UPPER, URL_LOWER,
} from './string-constants';

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

export const VERSION_ONE_DIRECTIVES = new Set<string>([
  DEPRECATED,
  EXTENDS,
  EXTERNAL,
  KEY,
  PROVIDES,
  REQUIRES,
  SPECIFIED_BY,
  TAG,
]);
export const VERSION_TWO_DIRECTIVES = new Set<string>([
  AUTHENTICATED,
  COMPOSE_DIRECTIVE,
  LINK,
  OVERRIDE,
  INACCESSIBLE,
  INTERFACE_OBJECT,
  REQUIRES_SCOPES,
  SHAREABLE,
]);

export const BASE_DIRECTIVE_DEFINITIONS: DirectiveDefinitionNode[] = [
  /* directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE |
     FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  */
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode(REASON),
        type: stringToNamedTypeNode(STRING_SCALAR),
        defaultValue: {
          kind: Kind.STRING,
          value: 'No longer supported',
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
  },
  // directive @extends on INTERFACE | OBJECT
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringArrayToNameNodeArray([INTERFACE_UPPER, OBJECT_UPPER]),
    name: stringToNameNode(EXTENDS),
    repeatable: false,
  },
  // directive @external on FIELD_DEFINITION | OBJECT
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
    name: stringToNameNode(EXTERNAL),
    repeatable: false,
  },
  // directive @eventsPublish(topic: String!, sourceID: String) on FIELD_DEFINITION
  {
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
        name: stringToNameNode(SOURCE_ID),
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    ],
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
    name: stringToNameNode(EVENTS_PUBLISH),
    repeatable: false,
  },
  // directive @eventsRequest(topic: String!, sourceID: String) on FIELD_DEFINITION
  {
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
        name: stringToNameNode(SOURCE_ID),
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    ],
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
    name: stringToNameNode(EVENTS_REQUEST),
    repeatable: false,
  },
  // directive @eventsSubscribe(topic: String!, sourceID: String) on FIELD_DEFINITION
  {
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
        name: stringToNameNode(SOURCE_ID),
        type: stringToNamedTypeNode(STRING_SCALAR),
      },
    ],
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
    name: stringToNameNode(EVENTS_SUBSCRIBE),
    repeatable: false,
  },
  // directive @key(fields: openfed__FieldSet!) on INTERFACE | OBJECT
  {
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
        type: stringToNamedTypeNode(BOOLEAN_TYPE),
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
  },
  // directive @provides(fields: openfed__FieldSet!) on FIELD_DEFINITION
  {
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
  },
  // directive @requires(fields: openfed__FieldSet!) on FIELD_DEFINITION
  {
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
  },
  // directive @specifiedBy(url: String!) on SCALAR
  {
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
  },
  /* directive @tag(name: String!) on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_OBJECT |
     INPUT_FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR | UNION
  */
  {
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
  },
];

export const VERSION_TWO_DIRECTIVE_DEFINITIONS: DirectiveDefinitionNode[] = [
  // @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  {
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
  },
  // @composeDirective is currently unimplemented
  /* directive @composeDirective(name: String!) repeatable on SCHEMA */
  {
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
  },
  /* directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_OBJECT |
     INPUT_FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR | UNION
  */
  {
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
  },
  // directive @interfaceObject on OBJECT
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringArrayToNameNodeArray([OBJECT_UPPER]),
    name: stringToNameNode(INTERFACE_OBJECT),
    repeatable: false,
  },
  // directive @link(url: String!, as: String!, for: String, import: [String]) repeatable on SCHEMA
  {
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
  },
  // directive @override(from: String!) on FIELD_DEFINITION
  {
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
  },
  // @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
  {
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
                }
              }
            }
          }
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
  },
  // directive @shareable on FIELD_DEFINITION | OBJECT
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
    name: stringToNameNode(SHAREABLE),
    repeatable: false,
  },
];

export const FIELD_SET_SCALAR_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(FIELD_SET_SCALAR),
};

export const SCOPE_SCALAR_DEFINITION: ScalarTypeDefinitionNode = {
  kind: Kind.SCALAR_TYPE_DEFINITION,
  name: stringToNameNode(SCOPE_SCALAR),
};
