import { describe, expect, test, type TestContext } from 'vitest';
import {
  getFragments,
  collectRootFields,
  collectRootOccurrences,
  getOperation,
  parseQuery,
} from '../src/components/playground/defer-advisor/operation';
import { summarizeRootFields } from '../src/components/playground/defer-advisor/root-field-summary';

const parsed = (query: string) => {
  const result = parseQuery(query);
  if (!result) {
    throw new Error(`test query does not parse: ${query}`);
  }
  return result;
};

// Takes the test context so a missing operation fails the test with a message instead of throwing.
const rootNames = (context: TestContext, query: string) => {
  const { doc } = parsed(query);
  const operation = getOperation(doc);
  context.expect(operation, 'No operation').toBeTruthy();
  return collectRootFields(operation?.selectionSet.selections ?? [], getFragments(doc)).map((f) => f.name.value);
};

describe('root field collection through named fragments', () => {
  test('includes fields reached through a root fragment spread', (context) => {
    expect(rootNames(context, 'query { b ...F } fragment F on Query { a }')).toEqual(['b', 'a']);
  });

  test('follows fragments that spread other fragments', (context) => {
    expect(rootNames(context, 'query { ...F } fragment F on Query { ...G } fragment G on Query { a }')).toEqual(['a']);
  });

  test('stops on a fragment cycle instead of recursing forever', (context) => {
    expect(rootNames(context, 'query { ...F } fragment F on Query { a ...F }')).toEqual(['a']);
  });

  test('keeps the old behaviour when no fragments are passed', () => {
    const { doc } = parsed('query { b ...F } fragment F on Query { a }');
    const operation = getOperation(doc);
    expect(collectRootFields(operation?.selectionSet.selections ?? []).map((f) => f.name.value)).toEqual(['b']);
  });
});

describe('root occurrences through named fragments', () => {
  test('marks spread-sourced fields as outside the operation body', () => {
    const { doc } = parsed('query { b ...F } fragment F on Query { a }');
    const operation = getOperation(doc);
    expect(collectRootOccurrences(operation?.selectionSet.selections ?? [], getFragments(doc))).toEqual([
      { name: 'b', deferred: false, inBody: true },
      { name: 'a', deferred: false, inBody: false },
    ]);
  });

  test('a spread inside a defer fragment counts as deferred', () => {
    const { doc } = parsed('query { ... @defer(label: "x") { ...F } } fragment F on Query { a }');
    const operation = getOperation(doc);
    expect(collectRootOccurrences(operation?.selectionSet.selections ?? [], getFragments(doc))).toEqual([
      { name: 'a', deferred: true, inBody: false },
    ]);
  });
});

describe('root field summary with named fragments', () => {
  test('shows a spread-only field without a Defer button', () => {
    expect(summarizeRootFields(parsed('query { ...F } fragment F on Query { a }'))).toEqual([
      { name: 'a', undeferred: 0, deferredLabels: [], eagerLabels: [] },
    ]);
  });

  test('counts only body occurrences towards the Defer button', () => {
    expect(summarizeRootFields(parsed('query { b ...F } fragment F on Query { a b }'))).toEqual([
      { name: 'b', undeferred: 1, deferredLabels: [], eagerLabels: [] },
      { name: 'a', undeferred: 0, deferredLabels: [], eagerLabels: [] },
    ]);
  });
});
