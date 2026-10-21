import { afterEach, describe, expect, test, vi } from 'vitest';
import { probeRootFields, PROBE_RUNS } from '../src/components/playground/defer-advisor/probe';

// graphql's printer breaks selections across lines; compare the shape, not the layout.
const squash = (query: string) => query.replace(/\s+/g, ' ').trim();

type SentRequest = { query: string; variables: Record<string, unknown>; headers: Record<string, string> };

const captureRequests = async (run: () => Promise<unknown>): Promise<SentRequest[]> => {
  const fetchMock = vi.fn(async () => ({ json: async () => ({ data: {} }) }));
  vi.stubGlobal('fetch', fetchMock);
  await run();
  return fetchMock.mock.calls.map(([, init]) => {
    const requestInit = init as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    return {
      query: squash(body.query),
      variables: body.variables,
      headers: requestInit.headers as Record<string, string>,
    };
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probe documents with named fragments', () => {
  test('a field whose selection spreads a fragment carries the fragment definition', async () => {
    const sent = await captureRequests(() =>
      probeRootFields('http://router', 'query { user { ...UserFields } } fragment UserFields on User { id name }'),
    );
    expect(sent).toHaveLength(PROBE_RUNS);
    expect(sent[0]?.query).toBe('{ user { ...UserFields } } fragment UserFields on User { id name }');
  });

  test('fragments reached through another fragment are included transitively', async () => {
    const sent = await captureRequests(() =>
      probeRootFields(
        'http://router',
        'query { user { ...A } } fragment A on User { ...B } fragment B on User { id } fragment Unused on User { x }',
      ),
    );
    expect(sent[0]?.query).toBe('{ user { ...A } } fragment A on User { ...B } fragment B on User { id }');
  });

  test('a root field from a root fragment is probed on its own', async () => {
    const sent = await captureRequests(() =>
      probeRootFields('http://router', 'query { ...F } fragment F on Query { a }'),
    );
    expect(sent[0]?.query).toBe('{ a }');
  });
});

describe('probe variables', () => {
  test('sends the definition and value of a variable the field uses', async () => {
    const sent = await captureRequests(() =>
      probeRootFields('http://router', 'query($id: ID!) { user(id: $id) { id } }', {
        headers: {},
        variables: { id: '1' },
      }),
    );
    expect(sent[0]?.query).toBe('query($id: ID!) { user(id: $id) { id } }');
    expect(sent[0]?.variables).toEqual({ id: '1' });
  });

  test('drops variables the probed field does not use', async () => {
    const sent = await captureRequests(() =>
      probeRootFields('http://router', 'query($id: ID!, $unused: Int) { user(id: $id) { id } other }', {
        headers: {},
        variables: { id: '1', unused: 2 },
      }),
    );
    expect(sent.find((r) => r.query.includes('user'))).toEqual(
      expect.objectContaining({ query: 'query($id: ID!) { user(id: $id) { id } }', variables: { id: '1' } }),
    );
    expect(sent.find((r) => r.query.includes('other'))?.variables).toEqual({});
  });

  test('a variable used only inside a spread fragment is still defined', async () => {
    const sent = await captureRequests(() =>
      probeRootFields(
        'http://router',
        'query($id: ID!) { user { ...U } } fragment U on User { friend(id: $id) { id } }',
        {
          headers: {},
          variables: { id: '7' },
        },
      ),
    );
    expect(sent[0]?.query).toBe('query($id: ID!) { user { ...U } } fragment U on User { friend(id: $id) { id } }');
    expect(sent[0]?.variables).toEqual({ id: '7' });
  });
});

describe('probe headers', () => {
  test('sends the editor headers with the JSON content type', async () => {
    const sent = await captureRequests(() =>
      probeRootFields('http://router', 'query { a }', { headers: { authorization: 'Bearer t' }, variables: {} }),
    );
    expect(sent[0]?.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer t' });
  });

  test('an editor header can override the default content type, as a normal run allows', async () => {
    const sent = await captureRequests(() =>
      probeRootFields('http://router', 'query { a }', {
        headers: { 'content-type': 'application/graphql' },
        variables: {},
      }),
    );
    expect(sent[0]?.headers).toEqual({ 'content-type': 'application/graphql' });
  });
});
