import { describe, expect, test } from 'vitest';
import { federateSubgraphs } from '../../../src';
import { createSubgraph } from '../../utils/utils';

describe.each([
  ['subscription', 'Subscription', 'Events'],
  ['mutation', 'Mutation', 'Changes'],
])('context on %s root', (operation, canonical, custom) => {
  describe.each([canonical, custom])('%s', (root) => {
    function compose(fields: string, projection: string) {
      return federateSubgraphs({
        subgraphs: [
          createSubgraph(
            'accounts',
            `schema { query: Query ${operation}: ${root} }
          type Query { ping: Boolean }
          type ${root} @context(name: "event") { ${fields} }
          type Wallet @key(fields: "id") {
            id: ID!
            quote(value: ID @fromContext(field: ${JSON.stringify('$event ' + projection)})): ID
          }`,
          ),
        ],
      });
    }

    test('rejects a projection on a different event stream', () => {
      const result = compose('wallet: Wallet stamp: ID', '{ stamp }');
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.errors.map((error) => error.message).join()).toContain(`${canonical}.wallet.quote`);
    });

    test('checks a projection separately on each trigger reaching the receiver', () => {
      const result = compose('wallet: Wallet other: Wallet', '{ wallet { id } }');
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.errors.map((error) => error.message).join()).toContain(`${canonical}.other.quote`);
    });

    test('accepts projections on the active event and unrelated leaf triggers', () => {
      expect(compose('wallet: Wallet stamp: ID', `... on ${root} { wallet { id } }`).success).toBe(true);
    });

    test('rejects a fixed projection when subscribers can choose different trigger arguments', () => {
      const result = compose('wallet(tag: String): Wallet', '{ wallet(tag: "first") { id } }');
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.errors.map((error) => error.message).join()).toContain(`${canonical}.wallet.quote`);
    });
    test.each([
      ['(group: "active")', true],
      ['(group: "other")', false],
      ['', true],
    ] as const)('checks a hidden argument against the trigger default: %s', (args, expected) => {
      expect(
        compose('wallet(group: String = "active" @inaccessible): Wallet', `{ wallet${args} { id } }`).success,
      ).toBe(expected);
    });
  });
});
