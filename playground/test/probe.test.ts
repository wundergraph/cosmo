import { afterEach, describe, expect, test, vi } from 'vitest';
import { probeRootFields, PROBE_RUNS } from '../src/components/playground/defer-advisor/probe';

// graphql's printer breaks selections across lines; compare the shape, not the layout.
const squash = (query: string) => query.replace(/\s+/g, ' ').trim();

const sentQueries = () => {
  const fetchMock = vi.fn(async () => ({ json: async () => ({ data: {} }) }));
  vi.stubGlobal('fetch', fetchMock);
  return {
    queries: async (run: () => Promise<unknown>) => {
      await run();
      return fetchMock.mock.calls.map(([, init]) =>
        squash(JSON.parse(String((init as RequestInit).body)).query as string),
      );
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probe documents with named fragments', () => {
  test('a field whose selection spreads a fragment carries the fragment definition', async () => {
    const { queries } = sentQueries();
    const sent = await queries(() =>
      probeRootFields('http://router', 'query { user { ...UserFields } } fragment UserFields on User { id name }'),
    );
    expect(sent).toHaveLength(PROBE_RUNS);
    expect(sent[0]).toBe('{ user { ...UserFields } } fragment UserFields on User { id name }');
  });

  test('fragments reached through another fragment are included transitively', async () => {
    const { queries } = sentQueries();
    const sent = await queries(() =>
      probeRootFields(
        'http://router',
        'query { user { ...A } } fragment A on User { ...B } fragment B on User { id } fragment Unused on User { x }',
      ),
    );
    expect(sent[0]).toBe('{ user { ...A } } fragment A on User { ...B } fragment B on User { id }');
  });

  test('a root field from a root fragment is probed on its own', async () => {
    const { queries } = sentQueries();
    const sent = await queries(() => probeRootFields('http://router', 'query { ...F } fragment F on Query { a }'));
    expect(sent[0]).toBe('{ a }');
  });
});
