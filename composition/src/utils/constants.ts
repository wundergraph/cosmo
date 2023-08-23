import { DirectiveDefinitionNode, Kind } from 'graphql';
import { stringToNamedTypeNode, stringToNameNode, stringToNameNodes } from '../ast/utils';
import {
  ARGUMENT_DEFINITION_UPPER,
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
  NAME,
  OBJECT_UPPER,
  PROVIDES,
  REQUIRES,
  SCALAR_UPPER,
  SHAREABLE,
  STRING_TYPE,
  TAG,
  UNION_UPPER,
} from './string-constants';

export const BASE_SCALARS = new Set<string>(['Boolean', 'Float', 'ID', 'Int', 'String']);

export const VERSION_ONE_DIRECTIVES = new Set<string>([DEPRECATED, EXTENDS, EXTERNAL, KEY, PROVIDES, REQUIRES, TAG]);
export const VERSION_TWO_DIRECTIVES = new Set<string>([INACCESSIBLE, SHAREABLE]);

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
    locations: stringToNameNodes([
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
    locations: stringToNameNodes([INTERFACE_UPPER, OBJECT_UPPER]),
    name: stringToNameNode(EXTENDS),
    repeatable: false,
  },
  // directive @external on FIELD_DEFINITION | OBJECT
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringToNameNodes([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
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
    locations: stringToNameNodes([
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
  /* directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION |INPUT_OBJECT |
     INPUT_FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR | UNION
  */
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringToNameNodes([
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
  // directive @shareable on FIELD_DEFINITION | OBJECT
  {
    kind: Kind.DIRECTIVE_DEFINITION,
    locations: stringToNameNodes([FIELD_DEFINITION_UPPER, OBJECT_UPPER]),
    name: stringToNameNode(SHAREABLE),
    repeatable: false,
  },
];
