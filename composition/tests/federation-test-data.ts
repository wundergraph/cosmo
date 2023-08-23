import { Subgraph } from '../src';
import { parse } from 'graphql';

export const baseSchema: Subgraph = {
  name: 'base-schema',
  url: '',
  definitions: parse(`
    directive @key(fields: String!) on OBJECT | INTERFACE

    directive @external on OBJECT | FIELD_DEFINITION

    directive @inaccessible on FIELD_DEFINITION | OBJECT | INTERFACE | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION

    directive @provides(fields: String!) on FIELD_DEFINITION

    directive @requires(fields: String!) on FIELD_DEFINITION

    directive @shareable on OBJECT | FIELD_DEFINITION

    type Query {
      _entities(representations: [_Any!]!): [_Entity]!
      _service: _Service!
    }

    scalar _Entity

    scalar _Any

    type _Service {
      """
      The sdl representing the federated service capabilities. Includes federation directives, removes federation types, and includes rest of full schema after schema directives have been applied
      """
      sdl: String
    }
  `),
};
