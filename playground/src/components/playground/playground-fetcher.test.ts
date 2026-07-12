import { buildSchema, introspectionFromSchema, parse, validate } from 'graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeferAdvisorHeaders,
  buildPlaygroundSchema,
  createPlaygroundHTTPFetch,
  preparePlaygroundHeaders,
  schemaForGraphiQLEditor,
} from './playground-fetcher';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPlaygroundHTTPFetch', () => {
  it('builds advisor headers after the main transport transform and environment substitution', () => {
    let token = 'first-token';
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'playground:env' ? JSON.stringify({ '0': { TOKEN: token } }) : null),
    });
    const transformHeaders = vi.fn((headers: Record<string, string>) => ({
      ...headers,
      authorization: 'Bearer {{ TOKEN }}',
      'x-transformed': 'yes',
      'x-wg-trace': 'true',
    }));

    const first = preparePlaygroundHeaders({ 'x-tab': 'active' }, { transformHeaders });
    expect(buildDeferAdvisorHeaders(first, { runs: 3 })).toEqual({
      'x-tab': 'active',
      authorization: 'Bearer first-token',
      'x-transformed': 'yes',
      'Content-Type': 'application/json',
      'X-WG-Defer-Advisor': 'enable',
      'X-WG-Defer-Advisor-Runs': '3',
    });
    expect(transformHeaders).toHaveBeenCalledWith({ 'x-tab': 'active' });

    token = 'second-token';
    const second = preparePlaygroundHeaders({ 'x-tab': 'active' }, { transformHeaders });
    expect(second.authorization).toBe('Bearer second-token');
    expect(second).not.toEqual(first);
  });

  it('uses the supplied fetch and preserves transformed authentication headers and pre-scripts', async () => {
    const order: string[] = [];
    const customFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      order.push('fetch');
      return new Response(JSON.stringify({ data: { viewer: { id: '1' } } }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    const runPreOperation = vi.fn(async () => {
      order.push('pre');
    });
    const onResponseStatus = vi.fn();
    const httpFetch = createPlaygroundHTTPFetch({
      fetchImplementation: customFetch,
      schema: null,
      clientValidationEnabled: true,
      scripts: {
        transformHeaders: (headers) => ({ ...headers, authorization: 'Bearer custom-token' }),
      },
      runPreOperation,
      onResponseStatus,
    });

    const response = await httpFetch(new URL('https://router.example/graphql'), {
      method: 'POST',
      headers: { 'x-client': 'playground' },
      body: JSON.stringify({ query: '{ viewer { id } }' }),
    });

    expect(await response.json()).toEqual({ data: { viewer: { id: '1' } } });
    expect(order).toEqual(['pre', 'fetch']);
    expect(runPreOperation).toHaveBeenCalledWith('0', { query: '{ viewer { id } }' });
    expect(customFetch).toHaveBeenCalledOnce();
    expect(customFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-client': 'playground',
      authorization: 'Bearer custom-token',
    });
    expect(onResponseStatus).toHaveBeenCalledWith(200, '');
  });

  it('preserves client validation and does not call scripts or fetch for an invalid operation', async () => {
    const customFetch = vi.fn();
    const runPreOperation = vi.fn();
    const httpFetch = createPlaygroundHTTPFetch({
      fetchImplementation: customFetch,
      schema: buildSchema('type Query { viewer: String! }'),
      clientValidationEnabled: true,
      runPreOperation,
    });

    const response = await httpFetch(new URL('https://router.example/graphql'), {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ query: '{ missing }' }),
    });

    await expect(response.json()).resolves.toMatchObject({
      message: 'Client-side validation failed. The request was not sent to the Router.',
      errors: [{ message: 'Cannot query field "missing" on type "Query".' }],
    });
    expect(runPreOperation).not.toHaveBeenCalled();
    expect(customFetch).not.toHaveBeenCalled();
  });

  it('records and rethrows network failures so execution state cannot look complete', async () => {
    const onResponseStatus = vi.fn();
    const httpFetch = createPlaygroundHTTPFetch({
      fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
      schema: null,
      clientValidationEnabled: true,
      runPreOperation: vi.fn(),
      onResponseStatus,
    });

    await expect(
      httpFetch(new URL('https://router.example/graphql'), {
        method: 'POST',
        headers: {},
        body: JSON.stringify({ query: '{ viewer { id } }' }),
      }),
    ).rejects.toThrow('Failed to fetch from router due to network errors');
    expect(onResponseStatus).toHaveBeenCalledWith(undefined, 'Network Error');
  });

  it('accepts defer during client validation when router introspection omits the directive', async () => {
    const customFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { viewer: { id: '1', name: 'Ada' } } }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const schema = buildPlaygroundSchema(
      introspectionFromSchema(
        buildSchema(`
          type Query { viewer: Viewer! }
          type Viewer { id: ID!, name: String! }
        `),
      ),
    );
    const httpFetch = createPlaygroundHTTPFetch({
      fetchImplementation: customFetch,
      schema,
      clientValidationEnabled: true,
      runPreOperation: vi.fn(),
    });

    await httpFetch(new URL('https://router.example/graphql'), {
      method: 'POST',
      headers: {},
      body: JSON.stringify({ query: '{ viewer { id ... @defer { name } } }' }),
    });

    expect(customFetch).toHaveBeenCalledOnce();
    expect(schema.getDirective('defer')).toBeDefined();
  });

  it('provides the augmented schema to GraphiQL editor validation', () => {
    const schema = schemaForGraphiQLEditor(
      buildPlaygroundSchema(
        introspectionFromSchema(
          buildSchema(`
            type Query { viewer: Viewer! }
            type Viewer { id: ID!, name: String! }
          `),
        ),
      ),
    );

    expect(schema).toBeDefined();
    expect(schema?.getDirective('defer')).toBeDefined();
    expect(schema && validate(schema, parse('{ viewer { id ... @defer { name } } }'))).toEqual([]);
  });
});
