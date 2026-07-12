import { buildSchema } from 'graphql';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./defer-inline', () => ({
  clearInlineAnnotations: vi.fn(),
  renderInlineAnnotations: vi.fn(),
  showInlineNotice: vi.fn(),
}));
vi.mock('@/components/playground/custom-scripts', () => ({
  attachPlaygroundAPI: vi.fn(),
  detachPlaygroundAPI: vi.fn(),
}));

import {
  buildInlineDeferAdvisorRequest,
  inlineDeferAdvisorIdentity,
  readInlineDeferAdvisorResponse,
  useInlineDeferAdvisor,
} from './use-inline-defer-advisor';
import { renderInlineAnnotations, showInlineNotice } from './defer-inline';

const schema = buildSchema(`
  type Query { viewer(id: ID!): String! }
  type Mutation { rename(name: String!): String! }
  type Subscription { renamed: String! }
`);

describe('buildInlineDeferAdvisorRequest', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a query-only request for the exact selected operation and validates its variables', () => {
    const document = `
      query First($id: ID!) { viewer(id: $id) }
      query Second($id: ID!) { viewer(id: $id) }
    `;

    expect(
      buildInlineDeferAdvisorRequest({
        graphId: 'graph-id',
        graphRequestToken: 'managed-token',
        operationName: 'Second',
        query: document,
        schema,
        serializedHeaders: '{}',
        serializedVariables: '{"id":"2"}',
        target: 'graph',
      }),
    ).toMatchObject({
      ok: true,
      body: {
        operationName: 'Second',
        query: document,
        variables: { id: '2' },
      },
    });

    expect(
      buildInlineDeferAdvisorRequest({
        graphId: 'graph-id',
        graphRequestToken: 'managed-token',
        operationName: undefined,
        query: document,
        schema,
        serializedHeaders: '{}',
        serializedVariables: '{"id":"2"}',
        target: 'graph',
      }),
    ).toEqual({ ok: false, notice: 'defer advisor: select a query operation' });

    expect(
      buildInlineDeferAdvisorRequest({
        graphId: 'graph-id',
        graphRequestToken: 'managed-token',
        operationName: 'Missing',
        query: document,
        schema,
        serializedHeaders: '{}',
        serializedVariables: '{"id":"2"}',
        target: 'graph',
      }),
    ).toEqual({ ok: false, notice: 'defer advisor: operation "Missing" was not found' });

    expect(
      buildInlineDeferAdvisorRequest({
        graphId: 'graph-id',
        graphRequestToken: 'managed-token',
        operationName: 'Second',
        query: document,
        schema,
        serializedHeaders: '{}',
        serializedVariables: '{"wrong":true}',
        target: 'graph',
      }),
    ).toMatchObject({ ok: false });
  });

  it('rejects mutation, subscription, malformed variables, and malformed headers before fetch', () => {
    const base = {
      graphId: 'graph-id',
      graphRequestToken: 'managed-token',
      operationName: undefined,
      schema,
      serializedHeaders: '{}',
      serializedVariables: '{}',
      target: 'graph' as const,
    };

    expect(buildInlineDeferAdvisorRequest({ ...base, query: 'mutation { rename(name: "Ada") }' })).toEqual({
      ok: false,
      notice: 'defer advisor: only query operations can be measured',
    });
    expect(buildInlineDeferAdvisorRequest({ ...base, query: 'subscription { renamed }' })).toEqual({
      ok: false,
      notice: 'defer advisor: only query operations can be measured',
    });
    expect(
      buildInlineDeferAdvisorRequest({
        ...base,
        query: 'query($id: ID!) { viewer(id: $id) }',
        serializedVariables: '[',
      }),
    ).toEqual({ ok: false, notice: 'defer advisor: variables must be a valid JSON object' });
    expect(buildInlineDeferAdvisorRequest({ ...base, query: '{ viewer(id: "1") }', serializedHeaders: '[]' })).toEqual({
      ok: false,
      notice: 'defer advisor: headers must be a valid JSON object',
    });
  });

  it('uses environment-substituted active headers while replacing reserved headers case-insensitively', () => {
    localStorage.setItem('playground:env', JSON.stringify({ 'graph-id': { TOKEN: 'env-token' } }));

    const result = buildInlineDeferAdvisorRequest({
      featureFlagName: 'checkout-v2',
      graphId: 'graph-id',
      graphRequestToken: 'managed-token',
      operationName: undefined,
      query: '{ viewer(id: "1") }',
      schema,
      serializedHeaders: JSON.stringify({
        authorization: 'Bearer {{ TOKEN }}',
        'x-Wg-TrAcE': 'true',
        'X-wG-ToKeN': 'user-token',
        'x-feature-flag': 'wrong-flag',
      }),
      serializedVariables: '{}',
      target: 'featureFlag',
    });

    expect(result).toEqual({
      ok: true,
      body: { query: '{ viewer(id: "1") }' },
      headers: {
        authorization: 'Bearer env-token',
        'Content-Type': 'application/json',
        'X-Feature-Flag': 'checkout-v2',
        'X-WG-Defer-Advisor': 'enable',
        'X-WG-Defer-Advisor-Runs': '1',
        'X-WG-Defer-Advisor-Skip-Validation': 'true',
        'X-WG-Token': 'managed-token',
      },
    });
  });

  it('never sends the graph token or feature-flag header to a subgraph target', () => {
    const result = buildInlineDeferAdvisorRequest({
      featureFlagName: 'checkout-v2',
      graphId: 'graph-id',
      graphRequestToken: 'managed-token',
      operationName: undefined,
      query: '{ viewer(id: "1") }',
      schema,
      serializedHeaders: '{"X-WG-Token":"user-token","Authorization":"user-auth"}',
      serializedVariables: '{}',
      target: 'subgraph',
    });

    expect(result).toEqual({ ok: false, notice: 'defer advisor: unavailable for subgraph requests' });
  });
});

describe('inline defer advisor response handling', () => {
  it('treats 4xx and missing advisor extensions as visible permanent failures', async () => {
    await expect(
      readInlineDeferAdvisorResponse(
        new Response(JSON.stringify({ errors: [{ message: 'advisor disabled' }] }), {
          status: 403,
          statusText: 'Forbidden',
        }),
      ),
    ).resolves.toEqual({ kind: 'permanent-error', message: 'defer advisor: advisor disabled' });

    await expect(readInlineDeferAdvisorResponse(Response.json({ data: {} }))).resolves.toEqual({
      kind: 'permanent-error',
      message: 'defer advisor: this router does not support inline defer analysis',
    });
  });

  it('treats 5xx as retryable and returns advisor data from a successful response', async () => {
    await expect(
      readInlineDeferAdvisorResponse(new Response('unavailable', { status: 503, statusText: 'Unavailable' })),
    ).resolves.toEqual({
      kind: 'retryable-error',
      message: 'defer advisor: router returned 503; retrying',
    });

    const result = { outcome: 'no_candidates', runs: 1, totalDurationMs: { avgMs: 1, minMs: 1, maxMs: 1 } };
    await expect(
      readInlineDeferAdvisorResponse(Response.json({ extensions: { deferAdvisor: result } })),
    ).resolves.toEqual({
      kind: 'success',
      result,
    });
  });
});

describe('inlineDeferAdvisorIdentity', () => {
  it('changes for every request input and target input', () => {
    const base = {
      environmentRevision: '{}',
      featureFlagName: undefined,
      graphId: 'graph-id',
      graphRequestToken: 'token',
      headers: '{}',
      operationName: 'Selected',
      query: 'query Selected { viewer(id: "1") }',
      routingUrl: 'https://router.example/graphql',
      target: 'graph' as const,
      variables: '{}',
    };
    const identity = inlineDeferAdvisorIdentity(base);

    for (const changed of [
      { query: '{ viewer(id: "2") }' },
      { operationName: 'Other' },
      { variables: '{"id":"2"}' },
      { headers: '{"Authorization":"two"}' },
      { target: 'featureFlag' as const },
      { featureFlagName: 'canary' },
      { routingUrl: 'https://other.example/graphql' },
      { environmentRevision: '{"TOKEN":"two"}' },
    ]) {
      expect(inlineDeferAdvisorIdentity({ ...base, ...changed })).not.toBe(identity);
    }
  });
});

describe('useInlineDeferAdvisor lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.mocked(renderInlineAnnotations).mockClear();
    vi.mocked(showInlineNotice).mockClear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  const result = (marker: string) => ({
    fields: [],
    fetches: [],
    marker,
    outcome: 'no_candidates',
    runs: 1,
    suggestions: [],
    totalDurationMs: { avgMs: 1, maxMs: 1, minMs: 1 },
  });

  const renderAdvisorHook = async (fetchImpl: typeof fetch) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let editorValue = '{ viewer(id: "1") }';
    const cm = {
      getValue: () => editorValue,
      setValue: (value: string) => {
        editorValue = value;
      },
    };
    vi.spyOn(document, 'querySelector').mockReturnValue({ CodeMirror: cm } as any);

    type Props = { headers?: string; operationName?: string; query: string; target?: 'graph' | 'featureFlag' };
    const Harness = (props: Props) => {
      useInlineDeferAdvisor({
        debounceMs: 0,
        enabled: true,
        environmentRevision: '{}',
        featureFlagName: props.target === 'featureFlag' ? 'canary' : undefined,
        fetchImpl,
        graphId: 'graph-id',
        graphRequestToken: 'managed-token',
        headers: props.headers ?? '{}',
        operationName: props.operationName,
        pollIntervalMs: 3000,
        query: props.query,
        ready: true,
        schema,
        target: props.target ?? 'graph',
        url: 'https://router.example/graphql',
        variables: '{}',
      });
      return null;
    };

    const rerender = async (props: Props) => {
      editorValue = props.query;
      await act(async () => {
        root.render(createElement(Harness, props));
      });
    };
    await rerender({ query: editorValue });

    return {
      rerender,
      unmount: async () => {
        await act(async () => root.unmount());
      },
    };
  };

  it('aborts a superseded request and ignores its late result across identity changes', async () => {
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const hook = await renderAdvisorHook(fetchImpl);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const firstSignal = fetchImpl.mock.calls[0]?.[1]?.signal;

    await hook.rerender({ query: '{ viewer(id: "2") }' });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveFirst(Response.json({ extensions: { deferAdvisor: result('stale') } }));
      await Promise.resolve();
    });
    expect(renderInlineAnnotations).not.toHaveBeenCalled();

    await act(async () => {
      resolveSecond(Response.json({ extensions: { deferAdvisor: result('current') } }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderInlineAnnotations).toHaveBeenCalledOnce();
    expect(vi.mocked(renderInlineAnnotations).mock.calls[0]?.[2]).toMatchObject({ marker: 'current' });
    await hook.unmount();
  });

  it('shows a permanent 4xx failure and never polls it again', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'advisor access denied' }] }), {
        status: 403,
        statusText: 'Forbidden',
      }),
    );
    const hook = await renderAdvisorHook(fetchImpl);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(showInlineNotice).toHaveBeenLastCalledWith(expect.anything(), 'defer advisor: advisor access denied', false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    await hook.unmount();
  });

  it('retries a network failure and renders a later successful measurement', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({ extensions: { deferAdvisor: result('retried') } }));
    const hook = await renderAdvisorHook(fetchImpl);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(renderInlineAnnotations).mock.calls[0]?.[2]).toMatchObject({ marker: 'retried' });
    await hook.unmount();
  });
});
