import { describe, expect, test } from 'vitest';
import {
  createSubgraph,
  normalizeString,
  normalizeSubgraphSuccess,
  schemaToSortedNormalizedString,
} from '../../utils/utils';
import {
  CACHE_TAG,
  CONTEXT,
  FROM_CONTEXT,
  overrideDirectiveLabelArgumentWarning,
  POLICY,
  ROUTER_COMPATIBILITY_VERSION_ONE,
  unsupportedDirectiveWarning,
} from '../../../src';
import {
  CACHE_TAG_DIRECTIVE,
  CONTEXT_DIRECTIVE,
  FROM_CONTEXT_DIRECTIVE,
  OVERRIDE_DIRECTIVE,
  POLICY_DIRECTIVE,
  SCHEMA_QUERY_DEFINITION,
} from '../utils/utils';

describe('Unsupported directives test', () => {
  test('that defining @cacheTag produces a warning', () => {
    const a = createSubgraph(
      'a',
      `
      type Query {
        a: ID @cacheTag(format: "test")
      }
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${CACHE_TAG_DIRECTIVE}
      
      type Query {
        a: ID @cacheTag(format: "test")
      }
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      unsupportedDirectiveWarning({
        directiveName: CACHE_TAG,
        subgraphName: 'a',
      }),
    ]);
  });

  test('that defining @context produces a warning', () => {
    const a = createSubgraph(
      'a',
      `
      type Query @context(name: "test") {
        a: ID 
      }
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${CONTEXT_DIRECTIVE}
      
      type Query @context(name: "test") {
        a: ID 
      }
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      unsupportedDirectiveWarning({
        directiveName: CONTEXT,
        subgraphName: 'a',
      }),
    ]);
  });

  test('that defining @fromContext produces a warning', () => {
    const a = createSubgraph(
      'a',
      `
      type Query {
        a(a: ID @fromContext(field: "test")): ID
      }
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${FROM_CONTEXT_DIRECTIVE}
      
      scalar ContextFieldValue
      
      type Query {
        a(a: ID @fromContext(field: "test")): ID
      }
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      unsupportedDirectiveWarning({
        directiveName: FROM_CONTEXT,
        subgraphName: 'a',
      }),
    ]);
  });

  test('that manually defining scalar ContextFieldValue does not duplicate the definition', () => {
    const a = createSubgraph(
      'a',
      `
      scalar ContextFieldValue
      
      type Query {
        a(a: ID @fromContext(field: "test")): ID
      }
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${FROM_CONTEXT_DIRECTIVE}
      
      scalar ContextFieldValue
      
      type Query {
        a(a: ID @fromContext(field: "test")): ID
      }
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      unsupportedDirectiveWarning({
        directiveName: FROM_CONTEXT,
        subgraphName: 'a',
      }),
    ]);
  });

  test('that defining @policy produces a warning', () => {
    const a = createSubgraph(
      'a',
      `
      type Query {
        a: ID @policy(policies: [["test:test"]])
      }
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${POLICY_DIRECTIVE}
      
      type Query {
        a: ID @policy(policies: [["test:test"]])
      }
      
      scalar federation__Policy
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      unsupportedDirectiveWarning({
        directiveName: POLICY,
        subgraphName: 'a',
      }),
    ]);
  });

  test('that manually defining federation__Policy definition does not duplicate the definition', () => {
    const a = createSubgraph(
      'a',
      `
      type Query {
        a: ID @policy(policies: [["test:test"]])
      }
      
      scalar federation__Policy
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${POLICY_DIRECTIVE}
      
      type Query {
        a: ID @policy(policies: [["test:test"]])
      }
      
      scalar federation__Policy
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      unsupportedDirectiveWarning({
        directiveName: POLICY,
        subgraphName: 'a',
      }),
    ]);
  });

  test('that providing a value to an @override label argument produces a warning', () => {
    const a = createSubgraph(
      'a',
      `
      type Query {
        a: ID @override(from: "b", label: "test")
      }
      `,
    );
    const { schema, warnings } = normalizeSubgraphSuccess(a, ROUTER_COMPATIBILITY_VERSION_ONE);
    expect(schemaToSortedNormalizedString(schema)).toBe(
      normalizeString(`
      ${SCHEMA_QUERY_DEFINITION}
      
      ${OVERRIDE_DIRECTIVE}
      
      type Query {
        a: ID @override(from: "b", label: "test")
      }
    `),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings).toStrictEqual([
      overrideDirectiveLabelArgumentWarning({
        coords: 'Query.a',
        subgraphName: 'a',
      }),
    ]);
  });
});
