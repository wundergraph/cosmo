import { describe, expect, test } from 'vitest';
import {
  createSubgraph,
  federateSubgraphsSuccess,
  normalizeString,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import { ROUTER_COMPATIBILITY_VERSION_ONE, userDefinedDeferWarning } from '../../../src';
import { SCHEMA_QUERY_DEFINITION } from '../utils/utils';

describe('@defer directive tests', () => {
  describe('normalization', () => {
    test('that @defer with execution locations is removed', () => {
      const a = createSubgraph(
        'a',
        `
        directive @defer(label: String if: Boolean! = true) on FRAGMENT_SPREAD | INLINE_FRAGMENT
        
        type Query {
          a: ID
        }
      `,
      );
      const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}
        
          type Query {
            a: ID
          }
      `),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings).toStrictEqual([userDefinedDeferWarning(a.name)]);
    });

    test('that @defer with type system locations is removed', () => {
      const a = createSubgraph(
        'a',
        `
        directive @defer(label: String if: Boolean! = true) on FIELD_DEFINITION
        
        type Query {
          a: ID @defer
        }
      `,
      );
      const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
      expect(schemaToSortedNormalizedString(schema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}
        
          type Query {
            a: ID
          }
      `),
      );
      expect(warnings).toHaveLength(1);
      expect(warnings).toStrictEqual([userDefinedDeferWarning(a.name)]);
    });
  });

  describe('federation', () => {
    test('that @defer with execution locations is removed', () => {
      const a = createSubgraph(
        'a',
        `
        directive @defer(label: String if: Boolean! = true) on FRAGMENT_SPREAD | INLINE_FRAGMENT
        
        type Query {
          a: ID
        }
      `,
      );
      const b = createSubgraph(
        'b',
        `
        directive @defer(label: String if: Boolean! = true) on FRAGMENT_SPREAD | INLINE_FRAGMENT
        
        type Query {
          a: ID
        }
      `,
      );
      const { federatedGraphClientSchema, federatedGraphSchema, warnings } = federateSubgraphsSuccess(
        [a, b],
        ROUTER_COMPATIBILITY_VERSION_ONE,
      );
      expect(schemaToSortedNormalizedString(federatedGraphClientSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}
        
          type Query {
            a: ID
          }
      `),
      );
      expect(schemaToSortedNormalizedString(federatedGraphSchema)).toBe(
        normalizeString(`
          ${SCHEMA_QUERY_DEFINITION}
          
          type Query {
            a: ID
          }
      `),
      );
      expect(warnings).toHaveLength(2);
      expect(warnings).toStrictEqual([userDefinedDeferWarning(a.name), userDefinedDeferWarning(b.name)]);
    });
  });
});
