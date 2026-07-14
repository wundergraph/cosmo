import type { CreateFetcherOptions, Fetcher, FetcherParams } from '@graphiql/toolkit';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/playground/custom-scripts', () => ({
  attachPlaygroundAPI: vi.fn(),
  detachPlaygroundAPI: vi.fn(),
}));

import { createPlaygroundExecutionFetcher, usePlaygroundExecution } from './use-playground-execution';
import { createPlaygroundRequestKey } from './playground-request-key';

const params: FetcherParams = {
  query: 'query Test { fast slow }',
  operationName: 'Test',
};

const stream = (...values: unknown[]) =>
  (async function* () {
    for (const value of values) {
      yield value;
    }
  })();

const collect = async (result: unknown) => {
  const values: unknown[] = [];
  for await (const value of result as AsyncIterable<unknown>) {
    values.push(value);
  }
  return values;
};

const createFetcherFactory = (fetcher: Fetcher) => (_options: CreateFetcherOptions) => fetcher;

const createJSONFetcher =
  (options: CreateFetcherOptions): Fetcher =>
  async (requestParams, fetcherOptions) => {
    const response = await options.fetch!(options.url, {
      method: 'POST',
      body: JSON.stringify(requestParams),
      headers: fetcherOptions?.headers,
    });
    return response.json();
  };

const multipartResponse = (initial: unknown, terminal?: Promise<unknown>, signal?: AbortSignal | null) => {
  const boundary = 'graphql-boundary';
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `--${boundary}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(initial)}\r\n--${boundary}`,
        ),
      );

      const cancel = () => {
        if (!cancelled) {
          cancelled = true;
          controller.error(new DOMException('The operation was aborted.', 'AbortError'));
        }
      };
      signal?.addEventListener('abort', cancel, { once: true });

      if (terminal) {
        void terminal.then((payload) => {
          if (cancelled) {
            return;
          }
          controller.enqueue(
            encoder.encode(
              `\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--\r\n`,
            ),
          );
          controller.close();
        });
      } else {
        controller.enqueue(encoder.encode('--\r\n'));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': `multipart/mixed; boundary="${boundary}"` },
  });
};

describe('createPlaygroundExecutionFetcher', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes assembled snapshots and finalizes scripts and analytics exactly once after the terminal result', async () => {
    const postOperation = vi.fn().mockResolvedValue(undefined);
    const capture = vi.fn();
    const baseFetcher: Fetcher = () =>
      stream(
        {
          data: { fast: true },
          pending: [{ id: 'slow', path: [] }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'slow', data: { slow: true } }],
          completed: [{ id: 'slow' }],
          hasNext: false,
        },
      ) as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const result = fetcher(params);
    const iterator = ((await result) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { fast: true } } });
    expect(postOperation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: { fast: true, slow: true } },
    });
    expect(postOperation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await vi.waitFor(() => expect(postOperation).toHaveBeenCalledOnce());
    expect(postOperation).toHaveBeenCalledWith('graph-id', params, { data: { fast: true, slow: true } });
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('cosmo_studio_query_executed', { query_success: true });
  });

  it('uses errors from the final assembled result for query_success', async () => {
    const capture = vi.fn();
    const baseFetcher: Fetcher = () =>
      stream(
        {
          data: { fast: true },
          pending: [{ id: 'slow', path: [] }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'slow', errors: [{ message: 'slow failed' }] }],
          completed: [{ id: 'slow' }],
          hasNext: false,
        },
      ) as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: vi.fn(),
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await collect(await fetcher(params));
    await vi.waitFor(() => expect(capture).toHaveBeenCalledOnce());

    expect(capture).toHaveBeenCalledWith('cosmo_studio_query_executed', { query_success: false });
  });

  it('treats a one-value HTTP JSON iterable as one terminal result', async () => {
    const postOperation = vi.fn();
    const capture = vi.fn();
    const baseFetcher: Fetcher = () => stream({ data: { hello: 'world' } }) as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await expect(collect(await fetcher(params))).resolves.toEqual([{ data: { hello: 'world' } }]);
    await vi.waitFor(() => expect(postOperation).toHaveBeenCalledOnce());

    expect(capture).toHaveBeenCalledOnce();
  });

  it('reports an HTTP error from the terminal result and finalizes once', async () => {
    const postOperation = vi.fn();
    const capture = vi.fn();
    const onStatus = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ errors: [{ message: 'router failed' }] }, { status: 500, statusText: 'Failed' }),
      );
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createJSONFetcher,
      executePostOperation: postOperation,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onStatus,
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await expect(fetcher(params)).resolves.toEqual({ errors: [{ message: 'router failed' }] });
    await vi.waitFor(() => expect(postOperation).toHaveBeenCalledOnce());

    expect(onStatus).toHaveBeenLastCalledWith(500, 'Failed');
    expect(capture).toHaveBeenCalledWith('cosmo_studio_query_executed', { query_success: false });
  });

  it('keeps a network failure in the error phase when the synthetic response completes', async () => {
    const states: string[] = [];
    const fetcher = createPlaygroundExecutionFetcher({
      capture: vi.fn(),
      clientValidationEnabled: false,
      createFetcher: createJSONFetcher,
      executePostOperation: vi.fn(),
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onExecutionState: (state) => states.push(state.phase),
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await fetcher(params);
    await Promise.resolve();

    expect(states).toContain('error');
    expect(states.at(-1)).toBe('error');
  });

  it('never finalizes a stream that ends while hasNext remains true', async () => {
    const postOperation = vi.fn();
    const capture = vi.fn();
    const baseFetcher: Fetcher = () => stream({ data: { partial: true }, hasNext: true }) as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await expect(collect(await fetcher(params))).rejects.toMatchObject({ code: 'PREMATURE_EOF' });
    await Promise.resolve();

    expect(postOperation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('marks a cancelled stream without running terminal side effects', async () => {
    const postOperation = vi.fn();
    const capture = vi.fn();
    const states: string[] = [];
    const baseFetcher: Fetcher = () =>
      stream(
        { data: { partial: true }, hasNext: true },
        { data: { unreachable: true }, hasNext: false },
      ) as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onExecutionState: (state) => states.push(state.phase),
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const iterator = ((await fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await Promise.resolve();

    expect(states.at(-1)).toBe('cancelled');
    expect(postOperation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('does not overwrite a naturally completed execution when the iterator is returned afterward', async () => {
    const states: string[] = [];
    const baseFetcher: Fetcher = () => stream({ data: { complete: true }, hasNext: false }) as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture: vi.fn(),
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: vi.fn(),
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onExecutionState: (state) => states.push(state.phase),
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const iterator = ((await fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { complete: true } } });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await iterator.return?.();

    expect(states.at(-1)).toBe('complete');
  });

  it('marks an iterator failure without running terminal side effects', async () => {
    const streamError = new Error('connection lost');
    const postOperation = vi.fn();
    const capture = vi.fn();
    const states: string[] = [];
    const baseFetcher: Fetcher = () =>
      (async function* () {
        yield { data: { partial: true }, hasNext: true };
        throw streamError;
      })() as ReturnType<Fetcher>;
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onExecutionState: (state) => states.push(state.phase),
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await expect(collect(await fetcher(params))).rejects.toBe(streamError);
    await Promise.resolve();

    expect(states.at(-1)).toBe('error');
    expect(postOperation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('marks a synchronous base fetcher failure as an execution error before rethrowing', () => {
    const fetchError = new Error('fetcher setup failed');
    const states: string[] = [];
    const fetcher = createPlaygroundExecutionFetcher({
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(() => {
        throw fetchError;
      }),
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onExecutionState: (state) => states.push(state.phase),
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    expect(() => fetcher(params)).toThrow(fetchError);
    expect(states.at(-1)).toBe('error');
  });

  it('never finalizes introspection', async () => {
    const postOperation = vi.fn();
    const capture = vi.fn();
    const result = { data: { __schema: { queryType: { name: 'Query' } } } };
    const baseFetcher: Fetcher = () => Promise.resolve(result);
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    await expect(
      fetcher({
        query: 'query IntrospectionQuery { __schema { queryType { name } } }',
        operationName: 'IntrospectionQuery',
      }),
    ).resolves.toBe(result);
    await Promise.resolve();

    expect(postOperation).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('suppresses terminal side effects from a superseded execution', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const postOperation = vi.fn();
    const capture = vi.fn();
    let invocation = 0;
    const baseFetcher: Fetcher = () => {
      invocation++;
      if (invocation === 1) {
        return (async function* () {
          yield { data: { first: 'partial' }, hasNext: true };
          await firstGate;
          yield { data: { first: 'complete' }, hasNext: false };
        })() as ReturnType<Fetcher>;
      }
      return stream({ data: { second: 'complete' }, hasNext: false }) as ReturnType<Fetcher>;
    };
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      createFetcher: createFetcherFactory(baseFetcher),
      executePostOperation: postOperation,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const first = ((await fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await first.next();
    await collect(await fetcher({ ...params, query: 'query Second { second }' }));
    releaseFirst();
    await expect(first.next()).resolves.toEqual({ done: true, value: undefined });
    await vi.waitFor(() => expect(postOperation).toHaveBeenCalledOnce());

    expect(postOperation).toHaveBeenCalledWith(
      'graph-id',
      { ...params, query: 'query Second { second }' },
      { data: { second: 'complete' } },
    );
    expect(capture).toHaveBeenCalledOnce();
  });

  it('assembles a delayed multipart response through the real GraphiQL fetcher', async () => {
    let finish!: (payload: unknown) => void;
    const terminal = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const postOperation = vi.fn();
    const capture = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        multipartResponse({ data: { fast: true }, pending: [{ id: 'slow', path: [] }], hasNext: true }, terminal),
      );
    const fetcher = createPlaygroundExecutionFetcher({
      capture,
      clientValidationEnabled: false,
      executePostOperation: postOperation,
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const iterator = ((await fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { fast: true } } });
    expect(postOperation).not.toHaveBeenCalled();

    finish({
      incremental: [{ id: 'slow', data: { slow: true } }],
      completed: [{ id: 'slow' }],
      hasNext: false,
    });

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: { fast: true, slow: true } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await vi.waitFor(() => expect(postOperation).toHaveBeenCalledOnce());
    expect(capture).toHaveBeenCalledOnce();
  });

  it('actively aborts a stalled HTTP execution when another execution supersedes it', async () => {
    let firstInit: RequestInit | undefined;
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        firstInit = init;
        return firstResponse;
      })
      .mockResolvedValueOnce(Response.json({ data: { second: true } }));
    const fetcher = createPlaygroundExecutionFetcher({
      capture: vi.fn(),
      clientValidationEnabled: false,
      executePostOperation: vi.fn(),
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const firstIterator = ((await fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const firstNext = firstIterator.next();
    await vi.waitFor(() => expect(firstInit).toBeDefined());

    const secondResult = fetcher({ ...params, query: 'query Second { second }' });
    const wasAbortedImmediately = firstInit?.signal?.aborted ?? false;
    releaseFirst(Response.json({ data: { first: true } }));
    await firstNext;
    await collect(await secondResult);

    expect(wasAbortedImmediately).toBe(true);
  });

  it('immediately aborts and resolves return while next is still pending', async () => {
    let requestInit: RequestInit | undefined;
    let releaseRequest!: (response: Response) => void;
    const states: string[] = [];
    const statusTexts: Array<string | undefined> = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((resolve, reject) => {
          requestInit = init;
          releaseRequest = resolve;
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('The operation was aborted.', 'AbortError')),
            { once: true },
          );
        }),
    );
    const fetcher = createPlaygroundExecutionFetcher({
      capture: vi.fn(),
      clientValidationEnabled: false,
      executePostOperation: vi.fn(),
      fetchImpl,
      graphId: 'graph-id',
      graphRequestToken: 'signed-token',
      onExecutionState: (state) => states.push(state.phase),
      onStatus: (_status, statusText) => statusTexts.push(statusText),
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    });

    const iterator = ((await fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    const pendingNext = iterator.next();
    await vi.waitFor(() => expect(requestInit).toBeDefined());

    let returnResolved = false;
    const stopped = iterator.return?.().then((result) => {
      returnResolved = true;
      return result;
    });
    await Promise.resolve();
    const abortedImmediately = requestInit?.signal?.aborted ?? false;
    const resolvedImmediately = returnResolved;

    if (!abortedImmediately) {
      releaseRequest(Response.json({ data: { ignored: true } }));
    }
    await pendingNext;
    await stopped;

    expect(abortedImmediately).toBe(true);
    expect(resolvedImmediately).toBe(true);
    expect(states.at(-1)).toBe('cancelled');
    expect(statusTexts).not.toContain('Network Error');
  });
});

describe('usePlaygroundExecution', () => {
  beforeEach(() => {
    localStorage.clear();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  const options = (activeRequestKey: string, fetchImpl: typeof fetch) => ({
    activeRequestKey,
    clientValidationEnabled: false,
    fetchImpl,
    graphId: 'graph-id',
    graphRequestToken: 'signed-token',
    routingUrl: 'https://router.example/graphql',
    target: 'graph' as const,
  });

  const renderExecutionHook = async (activeRequestKey: string, fetchImpl: typeof fetch) => {
    const container = document.createElement('div');
    const root = createRoot(container);
    let current!: ReturnType<typeof usePlaygroundExecution>;
    const Harness = (props: { activeRequestKey: string }) => {
      current = usePlaygroundExecution(options(props.activeRequestKey, fetchImpl));
      return null;
    };
    const rerender = async (nextActiveRequestKey: string) => {
      await act(async () => {
        root.render(createElement(Harness, { activeRequestKey: nextActiveRequestKey }));
      });
    };
    await rerender(activeRequestKey);

    return {
      get current() {
        return current;
      },
      rerender,
      unmount: async () => {
        await act(async () => root.unmount());
      },
    };
  };

  it('retains a cancelled request state when switching A to B and back to A', async () => {
    let firstInit: RequestInit | undefined;
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      firstInit = init;
      return firstResponse;
    });
    const hook = await renderExecutionHook('A', fetchImpl);

    let firstNext!: Promise<IteratorResult<unknown>>;
    await act(async () => {
      const iterator = ((await hook.current.fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      firstNext = iterator.next();
      await vi.waitFor(() => expect(firstInit).toBeDefined());
    });
    expect(hook.current.execution.phase).toBe('streaming');

    await hook.rerender('B');
    expect(hook.current.execution.phase).toBe('idle');
    const wasAbortedOnSwitch = firstInit?.signal?.aborted ?? false;

    await hook.rerender('A');
    expect(hook.current.execution.phase).toBe('cancelled');

    releaseFirst(Response.json({ data: { ignored: true } }));
    await firstNext;
    expect(wasAbortedOnSwitch).toBe(true);
    await hook.unmount();
  });

  it('retains an incomplete request state when switching away and back', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(multipartResponse({ data: { partial: true }, hasNext: true }));
    const hook = await renderExecutionHook('A', fetchImpl);

    await act(async () => {
      await expect(collect(await hook.current.fetcher(params))).rejects.toMatchObject({ code: 'PREMATURE_EOF' });
    });
    expect(hook.current.execution.phase).toBe('incomplete');

    await hook.rerender('B');
    expect(hook.current.execution.phase).toBe('idle');
    await hook.rerender('A');
    expect(hook.current.execution.phase).toBe('incomplete');
    await hook.unmount();
  });

  it('adopts the first GraphiQL tab fingerprint without aborting the initial execution', async () => {
    const fallbackRequest = {
      headers: '{"X-Test":"fallback"}',
      query: params.query,
      variables: '{"enabled":true}',
    };
    const initialRequestKey = createPlaygroundRequestKey(undefined, fallbackRequest);
    const firstTabKey = createPlaygroundRequestKey(
      {
        headers: null,
        id: 'first-graphiql-tab',
        operationName: 'Test',
        query: null,
        variables: null,
      },
      fallbackRequest,
    );
    expect(firstTabKey).not.toBe(initialRequestKey);

    let requestInit: RequestInit | undefined;
    let releaseRequest!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          requestInit = init;
          releaseRequest = resolve;
        }),
    );
    const hook = await renderExecutionHook(initialRequestKey, fetchImpl);
    let iterator!: AsyncIterator<unknown>;
    let firstResult!: Promise<IteratorResult<unknown>>;
    await act(async () => {
      iterator = ((await hook.current.fetcher(params)) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      firstResult = iterator.next();
      await vi.waitFor(() => expect(requestInit).toBeDefined());
    });

    await hook.rerender(firstTabKey);
    expect(requestInit?.signal?.aborted).toBe(false);

    await act(async () => {
      releaseRequest(Response.json({ data: { first: true } }));
      await firstResult;
      await iterator.next();
    });
    await hook.unmount();
  });

  it('adopts the first real GraphiQL tab for a selected operation in a multi-operation document', async () => {
    const fallbackRequest = {
      headers: '{"X-Test":"fallback"}',
      query: 'query First { first } query Selected { selected }',
      variables: '{"enabled":true}',
    };
    const initialRequestKey = createPlaygroundRequestKey(undefined, fallbackRequest);
    const firstTabKey = createPlaygroundRequestKey(
      {
        ...fallbackRequest,
        id: 'first-graphiql-tab',
        operationName: 'Selected',
      },
      fallbackRequest,
    );

    let requestInit: RequestInit | undefined;
    let releaseRequest!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise<Response>((resolve) => {
          requestInit = init;
          releaseRequest = resolve;
        }),
    );
    const hook = await renderExecutionHook(initialRequestKey, fetchImpl);
    let iterator!: AsyncIterator<unknown>;
    let firstResult!: Promise<IteratorResult<unknown>>;
    await act(async () => {
      iterator = (
        (await hook.current.fetcher({
          ...params,
          query: fallbackRequest.query,
          operationName: 'Selected',
        })) as AsyncIterable<unknown>
      )[Symbol.asyncIterator]();
      firstResult = iterator.next();
      await vi.waitFor(() => expect(requestInit).toBeDefined());
    });

    await hook.rerender(firstTabKey);
    expect(requestInit?.signal?.aborted).toBe(false);

    await act(async () => {
      releaseRequest(Response.json({ data: { selected: true } }));
      await firstResult;
      await iterator.next();
    });
    expect(hook.current.execution.phase).toBe('complete');
    await hook.unmount();
  });

  it('distinguishes selected operations and execution targets in request keys', () => {
    const fallbackRequest = {
      headers: '{"X-Test":"value"}',
      query: 'query First { first } query Second { second }',
      variables: '{}',
    };
    const firstTab = { ...fallbackRequest, id: 'tab', operationName: 'First' };
    const secondTab = { ...firstTab, operationName: 'Second' };
    const graphIdentity = {
      featureFlagName: undefined,
      loadSchemaGraphId: 'graph-id',
      routingUrl: 'https://router.example/graphql',
      target: 'graph',
    } as const;

    const firstKey = createPlaygroundRequestKey(firstTab, fallbackRequest, graphIdentity);

    expect(createPlaygroundRequestKey(secondTab, fallbackRequest, graphIdentity)).not.toBe(firstKey);
    expect(
      createPlaygroundRequestKey(firstTab, fallbackRequest, {
        ...graphIdentity,
        featureFlagName: 'canary',
        loadSchemaGraphId: 'feature-flag-id',
        target: 'featureFlag',
      }),
    ).not.toBe(firstKey);
    expect(
      createPlaygroundRequestKey(firstTab, fallbackRequest, {
        ...graphIdentity,
        loadSchemaGraphId: 'subgraph-id',
        routingUrl: 'https://subgraph.example/graphql',
        target: 'subgraph',
      }),
    ).not.toBe(firstKey);
  });
});
