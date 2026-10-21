import { parse } from 'graphql';
import { describe, expect, test } from 'vitest';
import {
  applyDefer,
  listDeferLabels,
  listDeferredFields,
  makeUniqueLabel,
  revertDefer,
} from '../src/components/playground/defer-advisor/defer-transform';
import { parseQuery } from '../src/components/playground/defer-advisor/operation';
import { summarizeRootFields } from '../src/components/playground/defer-advisor/root-field-summary';

const parsed = (query: string) => {
  const result = parseQuery(query);
  if (!result) {
    throw new Error(`test query does not parse: ${query}`);
  }
  return result;
};

describe('only the first operation is advised', () => {
  const query = 'query First { pricing } query Second { reviews { text } }';

  test('applyDefer leaves a matching field in a later operation alone', () => {
    expect(applyDefer(parsed(query), 'reviews', 'reviews')).toBe(query);
  });

  test('revertDefer ignores a deferred fragment in a later operation', () => {
    const later = 'query First { pricing } query Second { ... @defer(label: "r") { reviews } }';

    expect(revertDefer(parsed(later), 'r')).toBe(later);
  });
});

describe('applyDefer with a field name that is already deferred', () => {
  const query =
    '{ ... @defer(label: "reviews") { reviews(productId: "2") { text } } reviews(productId: "1") { text } }';

  test('wraps the undeferred field, not the one that is already deferred', () => {
    const next = applyDefer(parsed(query), 'reviews', 'reviews_2');

    expect(listDeferredFields(parsed(next))).toEqual([
      { label: 'reviews', field: 'reviews' },
      { label: 'reviews_2', field: 'reviews' },
    ]);
    expect(next.match(/@defer/g)).toHaveLength(2);
    expect(next.indexOf('reviews_2')).toBeGreaterThan(next.indexOf('@defer(label: "reviews")'));
  });

  test('leaves the query alone when every matching field is already deferred', () => {
    const allDeferred = '{ ... @defer(label: "reviews") { reviews(productId: "2") { text } } }';

    expect(applyDefer(parsed(allDeferred), 'reviews', 'reviews_2')).toBe(allDeferred);
  });

  test('only wraps a root field, never a nested field with the same name', () => {
    const next = applyDefer(parsed('{ pricing { reviews } }'), 'reviews', 'reviews');

    expect(next).toBe('{ pricing { reviews } }');
  });
});

describe('applyDefer keeps the field as written', () => {
  test('an aliased field keeps its alias inside the wrapper', () => {
    const next = applyDefer(parsed('{ r: reviews(id: "1") { text } }'), 'r', 'r');

    expect(next).toBe('{ ... @defer(label: "r") { r: reviews(id: "1") { text } } }');
  });

  test('a multi-line field keeps its line breaks', () => {
    const next = applyDefer(parsed('{\n  reviews(id: "1") {\n    text\n  }\n}'), 'reviews', 'reviews');

    expect(next).toBe('{\n  ... @defer(label: "reviews") { reviews(id: "1") {\n    text\n  } }\n}');
  });
});

describe('applyDefer on a root field inside a non-deferred inline fragment', () => {
  test('wraps the root field through the fragment', () => {
    const next = applyDefer(parsed('{ ... on Query { pricing(id: "1") } }'), 'pricing', 'pricing');

    expect(listDeferredFields(parsed(next))).toEqual([{ label: 'pricing', field: 'pricing' }]);
  });
});

describe('revertDefer', () => {
  test('unwraps the fragment with the given label and keeps its fields', () => {
    const next = revertDefer(parsed('{ ... @defer(label: "x") { a b } }'), 'x');

    expect(next).not.toContain('@defer');
    expect(listDeferredFields(parsed(next))).toEqual([]);
    expect(next).toContain('a');
    expect(next).toContain('b');
  });

  test('keeps a trailing comment from swallowing the text after it', () => {
    const next = revertDefer(parsed('{ ... @defer(label: "x") { a # note\n } b }'), 'x');

    expect(() => parse(next)).not.toThrow();
    expect(listDeferredFields(parsed(next))).toEqual([]);
  });

  test('a # inside a string still gets a line break, which is harmless', () => {
    expect(revertDefer(parsed('{ ... @defer(label: "x") { a(s: "#") } b }'), 'x')).toBe('{ a(s: "#")\n b }');
  });

  test('unwrapping compact input keeps neighbouring names apart', () => {
    expect(revertDefer(parsed('{id...@defer(label:"x"){name}}'), 'x')).toBe('{id name}');
    expect(revertDefer(parsed('{...@defer(label:"x"){a}b}'), 'x')).toBe('{a b}');
  });

  test('a comment inside compact input still keeps the names apart', () => {
    expect(revertDefer(parsed('{id...@defer(label:"x"){a #n\n}}'), 'x')).toBe('{id a #n\n}');
  });

  test('text after the closing brace is not swallowed by a comment in the body', () => {
    expect(revertDefer(parsed('{\n  ... @defer(label:"x") {\n    a # c\n  } b\n}'), 'x')).toBe('{\n  a # c\n b\n}');
  });

  test('a # inside the label does not confuse the revert', () => {
    expect(revertDefer(parsed('{ ... @defer(label: "#x") { a } }'), '#x')).toBe('{ a }');
  });

  test('a conditional defer is left alone, so its if: condition is never dropped', () => {
    const query = 'query Q($c: Boolean!) {\n  ... @defer(if: $c, label: "x") {\n    a\n  }\n}';

    expect(revertDefer(parsed(query), 'x')).toBe(query);
    expect(listDeferredFields(parsed(query))).toEqual([]);
    expect(summarizeRootFields(parsed(query))).toEqual([]);
  });

  test('a comment on the line above a multi-line defer with @include stays on its own line', () => {
    const query = 'query Q($c: Boolean!) { ... @include(if: $c) # c\n  @defer(label: "x") { a } }';
    const next = revertDefer(parsed(query), 'x');

    expect(() => parse(next)).not.toThrow();
    expect(next).toContain('@include(if: $c)');
    expect(next).not.toContain('@defer');
  });

  test('keeps @include on the field when it removes a defer', () => {
    const query = 'query($c: Boolean!) { ... @defer(label: "x") @include(if: $c) { a } }';

    const next = revertDefer(parsed(query), 'x');

    expect(next).toContain('@include(if: $c)');
    expect(next).not.toContain('@defer');
    expect(() => parse(next)).not.toThrow();
  });

  test('ignores a fragment with the same label nested under a field', () => {
    const query = '{ p { ... @defer(label: "x") { r } } ... @defer(label: "x") { a } }';

    expect(revertDefer(parsed(query), 'x')).toBe('{ p { ... @defer(label: "x") { r } } a }');
  });

  test('leaves other deferred fragments alone', () => {
    const next = revertDefer(parsed('{ ... @defer(label: "x") { a } ... @defer(label: "y") { b } }'), 'x');

    expect(listDeferredFields(parsed(next))).toEqual([{ label: 'y', field: 'b' }]);
  });
});

describe('defer and eager keep the rest of the query as written', () => {
  const query = ['{', '  # the price is cached for an hour', '  pricing(id: "1") {', '    amount', '  }', '}'].join(
    '\n',
  );

  test('a comment and the layout around the field survive a defer', () => {
    const next = applyDefer(parsed(query), 'pricing', 'pricing');

    expect(next).toContain('# the price is cached for an hour');
    expect(next).toContain('pricing(id: "1") {\n    amount\n  }');
  });

  test('a comment survives an eager', () => {
    const deferred = applyDefer(parsed(query), 'pricing', 'pricing');

    expect(revertDefer(parsed(deferred), 'pricing')).toContain('# the price is cached for an hour');
    expect(listDeferredFields(parsed(revertDefer(parsed(deferred), 'pricing')))).toEqual([]);
  });
});

describe('makeUniqueLabel', () => {
  test('suffixes the base label until it is unused', () => {
    expect(makeUniqueLabel('reviews', new Set(['reviews', 'reviews_2']))).toBe('reviews_3');
  });
});

describe('listDeferredFields', () => {
  test('ignores a defer on a nested selection', () => {
    const query = '{ pricing { ... @defer(label: "p") { reviews } } reviews }';

    expect(listDeferredFields(parsed(query))).toEqual([]);
    expect(listDeferLabels(parsed(query))).toEqual(['p']);
  });

  test('lists a field that a nested fragment inside the defer wraps', () => {
    expect(listDeferredFields(parsed('{ ... @defer(label: "x") { ... on Query { a } } }'))).toEqual([
      { label: 'x', field: 'a' },
    ]);
  });

  test('lists a defer nested inside another defer under its own label', () => {
    expect(
      listDeferredFields(parsed('{ ... @defer(label: "a") { reviews ... @defer(label: "b") { pricing } } }')),
    ).toEqual([
      { label: 'a', field: 'reviews' },
      { label: 'b', field: 'pricing' },
    ]);
  });

  test('lists every field inside a deferred fragment', () => {
    expect(listDeferredFields(parsed('{ ... @defer(label: "m") { a b } }'))).toEqual([
      { label: 'm', field: 'a' },
      { label: 'm', field: 'b' },
    ]);
  });
});

describe('summarizeRootFields', () => {
  test('returns one row per field name, counting deferred and undeferred occurrences', () => {
    const query =
      '{ ... @defer(label: "reviews") { reviews(productId: "2") { text } } reviews(productId: "1") { text } }';

    expect(summarizeRootFields(parsed(query))).toEqual([
      { name: 'reviews', undeferred: 1, deferredLabels: ['reviews'], eagerLabels: ['reviews'] },
    ]);
  });

  test('does not mark a root field as deferred because of a nested defer', () => {
    const query = '{ pricing { ... @defer(label: "p") { reviews } } reviews }';

    expect(summarizeRootFields(parsed(query))).toEqual([
      { name: 'pricing', undeferred: 1, deferredLabels: [], eagerLabels: [] },
      { name: 'reviews', undeferred: 1, deferredLabels: [], eagerLabels: [] },
    ]);
  });

  test('offers no Eager for a label that also covers another field', () => {
    expect(summarizeRootFields(parsed('{ ... @defer(label: "m") { a b } }'))).toEqual([
      { name: 'a', undeferred: 0, deferredLabels: ['m'], eagerLabels: [] },
      { name: 'b', undeferred: 0, deferredLabels: ['m'], eagerLabels: [] },
    ]);
  });

  test('offers Eager when one fragment holds two occurrences of the same field', () => {
    expect(summarizeRootFields(parsed('{ ... @defer(label: "x") { reviews(id: "1") reviews(id: "2") } }'))).toEqual([
      { name: 'reviews', undeferred: 0, deferredLabels: ['x'], eagerLabels: ['x'] },
    ]);
  });

  test('only reads the first operation of a multi-operation document', () => {
    expect(summarizeRootFields(parsed('query A { pricing } query B { reviews }'))).toEqual([
      { name: 'pricing', undeferred: 1, deferredLabels: [], eagerLabels: [] },
    ]);
  });

  test('leaves out a field whose only occurrence is an unlabelled @defer', () => {
    expect(summarizeRootFields(parsed('{ ... @defer { pricing } }'))).toEqual([]);
  });

  test('lists every label on a field that is deferred more than once', () => {
    const query = '{ ... @defer(label: "a") { reviews(id: "1") } ... @defer(label: "b") { reviews(id: "2") } }';

    expect(summarizeRootFields(parsed(query))).toEqual([
      { name: 'reviews', undeferred: 0, deferredLabels: ['a', 'b'], eagerLabels: ['a', 'b'] },
    ]);
  });

  test('offers no Eager when a second fragment under the same label holds only a spread', () => {
    expect(summarizeRootFields(parsed('{ ... @defer(label: "a") { foo } ... @defer(label: "a") { ...F } }'))).toEqual([
      { name: 'foo', undeferred: 0, deferredLabels: ['a'], eagerLabels: [] },
    ]);
  });

  test('offers no Eager for a defer nested inside another defer, since reverting it leaves the field deferred', () => {
    expect(
      summarizeRootFields(parsed('{ ... @defer(label: "a") { reviews ... @defer(label: "b") { pricing } } }')),
    ).toEqual([
      { name: 'reviews', undeferred: 0, deferredLabels: ['a'], eagerLabels: ['a'] },
      { name: 'pricing', undeferred: 0, deferredLabels: ['b'], eagerLabels: [] },
    ]);
  });

  test('returns no rows for a query that does not parse', () => {
    expect(summarizeRootFields(parseQuery('{ a'))).toEqual([]);
  });
});
