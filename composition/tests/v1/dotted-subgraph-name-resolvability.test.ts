import { describe, expect, test } from 'vitest';
import { parse, ROUTER_COMPATIBILITY_VERSION_ONE, Subgraph } from '../../src';
import { federateSubgraphsFailure } from '../utils/utils';

// `Entity.name` has no `@key` owner, so it is unresolvable and composition must
// emit an entity-resolvability error. However, when a subgraph name contains a
// `.`, generating that error fatals.
function entityOwner(name: string): Subgraph {
  return {
    name,
    url: '',
    definitions: parse(`
      type Query {
        entity: Entity!
      }

      type Entity @key(fields: "id") {
        id: ID!
        age: Int!
      }
    `),
  };
}

const fieldOwner: Subgraph = {
  name: 'field-owner',
  url: '',
  definitions: parse(`
    type Entity {
      id: ID! @shareable
      name: String!
    }
  `),
};

describe('Entity-resolvability error generation with a period in a subgraph name', () => {
  test.each([['entity-owner'], ['my.subgraph']])(
    'reports the resolvability error when the entity-owning subgraph is named "%s"',
    (name) => {
      const { errors } = federateSubgraphsFailure([entityOwner(name), fieldOwner], ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('name');
    },
  );
});
