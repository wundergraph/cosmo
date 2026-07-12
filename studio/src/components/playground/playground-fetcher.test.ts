import { buildSchema } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withDeferDirective } from '@wundergraph/cosmo-shared/playground/defer-schema';

vi.mock('@/components/playground/custom-scripts', () => ({
  attachPlaygroundAPI: vi.fn(),
  detachPlaygroundAPI: vi.fn(),
}));

import { createStudioPlaygroundFetch } from './playground-fetcher';

const request = (headers: HeadersInit = {}) => ({
  method: 'POST',
  headers,
  body: JSON.stringify({
    query: 'query Test { hello }',
    operationName: 'Test',
  }),
});

describe('createStudioPlaygroundFetch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a multipart response untouched', async () => {
    const response = new Response('--graphql-boundary--', {
      headers: { 'content-type': 'multipart/mixed; boundary="graphql-boundary"' },
    });
    const json = vi.spyOn(response, 'json');
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'graph',
    });

    const result = await fetcher(new URL('https://router.example/graphql'), request());

    expect(result).toBe(response);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    ['TRUE', 'true'],
    ['exclusion option', 'exclude=a,b'],
    ['numeric option', '1'],
  ])('attaches the graph token for a non-empty case-insensitive trace %s', async (_name, traceValue) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'graph',
    });

    await fetcher(
      new URL('https://router.example/graphql'),
      request({
        'x-wg-tRaCe': traceValue,
      }),
    );

    const sentHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(sentHeaders.get('x-wg-token')).toBe('signed-token');
  });

  it('replaces every case-insensitive user token with the managed graph token', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'graph',
    });

    await fetcher(
      new URL('https://router.example/graphql'),
      request({
        'x-wg-trace': 'true',
        'x-wg-token': 'stale-lowercase-token',
        'X-WG-Token': 'stale-canonical-token',
      }),
    );

    const sentHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(sentHeaders.get('x-wg-token')).toBe('signed-token');
  });

  it('does not attach the graph token for an empty trace option', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'graph',
    });

    await fetcher(new URL('https://router.example/graphql'), request({ 'X-WG-Trace': '   ' }));

    const sentHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(sentHeaders.has('x-wg-token')).toBe(false);
  });

  it('preserves Studio header-name validation before the request is sent', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'graph',
    });

    const response = await fetcher(new URL('https://router.example/graphql'), request({ 'invalid header': 'value' }));

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toContain('Header name must be a valid HTTP token');
  });

  it('never sends the graph token to a selected subgraph', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'subgraph',
    });

    await fetcher(new URL('https://subgraph.example/graphql'), request({ 'X-WG-Trace': 'true' }));

    const sentHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(sentHeaders.has('x-wg-token')).toBe(false);
  });

  it('preserves feature-flag propagation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      featureFlagName: 'checkout-v2',
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'featureFlag',
    });

    await fetcher(new URL('https://router.example/graphql'), request());

    const sentHeaders = new Headers(fetchImpl.mock.calls[0][1]?.headers);
    expect(sentHeaders.get('x-feature-flag')).toBe('checkout-v2');
  });

  it('substitutes environment headers and runs pre-operation scripts before the custom fetch', async () => {
    localStorage.setItem('playground:env', JSON.stringify({ 'graph-id': { accessToken: 'secret' } }));
    localStorage.setItem(
      'playground:pre-operation:selected',
      JSON.stringify({ enabled: true, content: 'globalThis.__studioPreOperationRan = true;' }),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      expect((globalThis as typeof globalThis & { __studioPreOperationRan?: boolean }).__studioPreOperationRan).toBe(
        true,
      );
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
      return Response.json({ data: { hello: 'world' } });
    });
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: false,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      target: 'graph',
    });

    try {
      await fetcher(new URL('https://router.example/graphql'), request({ Authorization: 'Bearer {{ accessToken }}' }));
    } finally {
      delete (globalThis as typeof globalThis & { __studioPreOperationRan?: boolean }).__studioPreOperationRan;
    }

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('validates defer on fragment spreads against the augmented router schema', async () => {
    const schema = withDeferDirective(
      buildSchema(`
        type Query { viewer: Viewer! }
        type Viewer { name: String! }
      `),
    );
    const upstreamResponse = Response.json({ data: { viewer: { name: 'Ada' } } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse);
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: true,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      schema,
      target: 'graph',
    });

    const response = await fetcher(new URL('https://router.example/graphql'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `
          query Test {
            viewer {
              ...ViewerDetails @defer
            }
          }
          fragment ViewerDetails on Viewer { name }
        `,
        operationName: 'Test',
      }),
    });

    expect(response).toBe(upstreamResponse);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('validates defer on inline fragments against the augmented router schema', async () => {
    const schema = withDeferDirective(
      buildSchema(`
        type Query { viewer: Viewer! }
        type Viewer { name: String! }
      `),
    );
    const upstreamResponse = Response.json({ data: { viewer: { name: 'Ada' } } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstreamResponse);
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: true,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      schema,
      target: 'graph',
    });

    const response = await fetcher(new URL('https://router.example/graphql'), {
      method: 'POST',
      body: JSON.stringify({
        query: 'query Test { viewer { ... @defer { name } } }',
        operationName: 'Test',
      }),
    });

    expect(response).toBe(upstreamResponse);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects invalid defer placement before sending a request', async () => {
    const schema = withDeferDirective(buildSchema('type Query { hello: String! }'));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { hello: 'world' } }));
    const fetcher = createStudioPlaygroundFetch({
      clientValidationEnabled: true,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      schema,
      target: 'graph',
    });

    const response = await fetcher(new URL('https://router.example/graphql'), {
      method: 'POST',
      body: JSON.stringify({ query: 'query Test @defer { hello }', operationName: 'Test' }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      message: 'Client-side validation failed. The request was not sent to the Router.',
      errors: [{ message: expect.stringContaining('Directive "@defer" may not be used on QUERY') }],
    });
  });
});
