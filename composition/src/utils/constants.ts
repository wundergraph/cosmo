import { DirectiveDefinitionNode, Kind } from 'graphql';
import { stringArrayToNameNodeArray, stringToNamedTypeNode, stringToNameNode } from '../ast/utils';
import {
  ARGUMENT_DEFINITION_UPPER,
  BOOLEAN_TYPE,
  COMPOSE_DIRECTIVE,
  DEPRECATED,
  ENUM_UPPER,
  ENUM_VALUE_UPPER,
  EXTENDS,
  EXTERNAL,
  FIELD_DEFINITION_UPPER,
  FIELDS,
  INACCESSIBLE,
  INPUT_FIELD_DEFINITION_UPPER,
  INPUT_OBJECT_UPPER,
  INTERFACE_UPPER,
  KEY,
  LINK,
  NAME,
  OBJECT_UPPER,
  OVERRIDE,
  PROVIDES,
  REQUIRES,
  RESOLVABLE,
  SCALAR_UPPER,
  SCHEMA,
  SCHEMA_UPPER,
  SHAREABLE,
  STRING_TYPE,
  TAG,
  UNION_UPPER,
} from './string-constants';

export const BASE_SCALARS = new Set<string>(
  ['_Any', '_Entities', 'Boolean', 'Float', 'ID', 'Int', 'String'],
);

export const VERSION_ONE_DIRECTIVES = new Set<string>([
  DEPRECATED, EXTENDS, EXTERNAL, KEY, PROVIDES, REQUIRES, TAG,
]);
export const VERSION_TWO_DIRECTIVES = new Set<string>([
  COMPOSE_DIRECTIVE, LINK, OVERRIDE, INACCESSIBLE, SHAREABLE,
]);


export const BASE_DIRECTIVE_DEFINITIONS: DirectiveDefinitionNode[] = [
  /* directive @deprecated(reason: String = "No longer supported") on ARGUMENT_DEFINITION | ENUM_VALUE |
     FIELD_DEFINITION | INPUT_FIELD_DEFINITION
  */
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode('reason'),
        type: stringToNamedTypeNode(STRING_TYPE),
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
  // TODO handle FieldSet
  // directive @key(fields: String!) on OBJECT
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode(FIELDS),
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
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
    locations: [stringToNameNode(OBJECT_UPPER)],
    name: stringToNameNode(KEY),
    repeatable: true,
  },
  // TODO handle FieldSet
  // directive @provides(fields: FieldSet!) on FIELD_DEFINITION
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode(FIELDS),
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
        },
      },
    ],
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
    name: stringToNameNode(PROVIDES),
    repeatable: false,
  },
  // TODO handle FieldSet
  // directive @requires(fields: FieldSet!) on FIELD_DEFINITION
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode(FIELDS),
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
        },
      },
    ],
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: [stringToNameNode(FIELD_DEFINITION_UPPER)],
    name: stringToNameNode(REQUIRES),
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
          type: stringToNamedTypeNode(STRING_TYPE),
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
  // @composeDirective is currently unimplemented
  /* directive @composeDirective(name: String!) repeatable on SCHEMA */
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode(NAME),
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
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
  // directive @link(url: String!, as: String!, for: String, import: [String]) repeatable on SCHEMA
  {
    arguments: [
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode('url'),
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
        },
      },
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode('as'),
        type: stringToNamedTypeNode(STRING_TYPE),
      },
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode('for'),
        type: stringToNamedTypeNode(STRING_TYPE),
      },
      {
        kind: Kind.INPUT_VALUE_DEFINITION,
        name: stringToNameNode('import'),
        type: {
          kind: Kind.LIST_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
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
        name: stringToNameNode('from'),
        type: {
          kind: Kind.NON_NULL_TYPE,
          type: stringToNamedTypeNode(STRING_TYPE),
        },
      },
    ],
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringArrayToNameNodeArray([FIELD_DEFINITION_UPPER]),
    name: stringToNameNode(OVERRIDE),
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
