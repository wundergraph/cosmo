import type { Fetcher } from '@graphiql/toolkit';
import { describe, expect, it, vi } from 'vitest';
import {
  bindInitialTabState,
  createObservedPlaygroundFetcher,
  createTabExecutionTracker,
  getActiveTabExecution,
  type RequestTiming,
} from './use-playground-execution';
import { createPlaygroundHTTPFetch } from './playground-fetcher';

const stream = (...parts: unknown[]): AsyncIterable<unknown> =>
  (async function* () {
    for (const part of parts) {
      yield part;
    }
  })();

const collect = async (result: unknown) => {
  const values: unknown[] = [];
  for await (const value of result as AsyncIterable<unknown>) {
    values.push(value);
  }
  return values;
};

const nextMicrotask = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('createObservedPlaygroundFetcher', () => {
  it('publishes the initial assembled snapshot before a delayed terminal snapshot', async () => {
    let releaseTerminal!: () => void;
    const terminalReady = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const baseFetcher = (() =>
      (async function* () {
        yield {
          data: { product: { id: '1' } },
          pending: [{ id: 'details', path: ['product'] }],
          extensions: { trace: { state: 'running' } },
          hasNext: true,
        };
        await terminalReady;
        yield {
          incremental: [{ id: 'details', data: { name: 'Table' } }],
          completed: [{ id: 'details' }],
          extensions: { trace: { state: 'complete' } },
          hasNext: false,
        };
      })()) as Fetcher;
    const snapshots: unknown[] = [];
    const timings: RequestTiming[] = [];
    const postOperation = vi.fn();
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onResponse: (snapshot) => snapshots.push(snapshot),
      onTiming: (timing) => timings.push(timing),
      executePostOperation: postOperation,
    });

    const iterator = (fetcher({ query: '{ product { id ... @defer { name } } }' }) as AsyncIterable<unknown>)[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        data: { product: { id: '1' } },
        extensions: { trace: { state: 'running' } },
      },
    });
    expect(snapshots).toEqual([
      {
        data: { product: { id: '1' } },
        extensions: { trace: { state: 'running' } },
      },
    ]);
    expect(timings.at(-1)?.state).toBe('streaming');
    expect(postOperation).not.toHaveBeenCalled();

    releaseTerminal();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        data: { product: { id: '1', name: 'Table' } },
        extensions: { trace: { state: 'complete' } },
      },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await nextMicrotask();

    expect(snapshots.at(-1)).toEqual({
      data: { product: { id: '1', name: 'Table' } },
      extensions: { trace: { state: 'complete' } },
    });
    expect(timings.at(-1)?.state).toBe('complete');
    expect(postOperation).toHaveBeenCalledOnce();
    expect(postOperation).toHaveBeenCalledWith({ query: '{ product { id ... @defer { name } } }' }, snapshots.at(-1));
  });

  it('replaces an initial trace extension with the authoritative terminal trace', async () => {
    const snapshots: unknown[] = [];
    const baseFetcher = (() =>
      stream(
        {
          data: { value: true },
          pending: [{ id: 'slow', path: [] }],
          extensions: { trace: { fetches: [{ state: 'running' }] }, stable: { value: 1 } },
          hasNext: true,
        },
        {
          completed: [{ id: 'slow' }],
          extensions: { trace: { fetches: [{ state: 'complete' }] } },
          hasNext: false,
        },
      )) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onResponse: (snapshot) => snapshots.push(snapshot),
    });

    await collect(fetcher({ query: '{ value }' }));

    expect(snapshots).toHaveLength(2);
    expect(snapshots.at(-1)).toEqual({
      data: { value: true },
      extensions: {
        trace: { fetches: [{ state: 'complete' }] },
        stable: { value: 1 },
      },
    });
  });

  it('publishes plain JSON once and runs the terminal callback once', async () => {
    const response = { data: { value: true }, extensions: { trace: { complete: true } } };
    const snapshots: unknown[] = [];
    const postOperation = vi.fn();
    const baseFetcher = (() => stream(response)) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onResponse: (snapshot) => snapshots.push(snapshot),
      executePostOperation: postOperation,
    });

    await expect(collect(fetcher({ query: '{ value }' }))).resolves.toEqual([response]);
    await nextMicrotask();

    expect(snapshots).toEqual([response]);
    expect(postOperation).toHaveBeenCalledOnce();
    expect(postOperation).toHaveBeenCalledWith({ query: '{ value }' }, response);
  });

  it('runs the terminal callback when the terminal snapshot is observed even if the consumer does not pull EOF', async () => {
    const postOperation = vi.fn();
    const timings: RequestTiming[] = [];
    const baseFetcher = (() => stream({ data: { value: true }, hasNext: false })) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      executePostOperation: postOperation,
      onTiming: (timing) => timings.push(timing),
    });
    const iterator = (fetcher({ query: '{ value }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { value: true } } });
    await nextMicrotask();
    expect(postOperation).toHaveBeenCalledOnce();

    await iterator.return?.();
    await nextMicrotask();
    expect(postOperation).toHaveBeenCalledOnce();
    expect(timings.at(-1)?.state).toBe('complete');
  });

  it('does not replace a completed plain JSON timing with cancellation when the consumer stops at the value', async () => {
    const timings: RequestTiming[] = [];
    const baseFetcher = (() => stream({ data: { value: true } })) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onTiming: (timing) => timings.push(timing),
    });
    const iterator = (fetcher({ query: '{ value }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(timings.at(-1)?.state).toBe('complete');
  });

  it('captures a rejected terminal post-operation callback without running it twice', async () => {
    const failure = new Error('stored post-operation script is malformed');
    const rejectedThenable = {
      then: (_resolve: (value: void) => void, reject: (error: Error) => void) => {
        reject(failure);
      },
    } as unknown as Promise<void>;
    const postOperation = vi.fn(() => rejectedThenable);
    const onPostOperationError = vi.fn();
    const baseFetcher = (() => stream({ data: { value: true }, hasNext: false })) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      executePostOperation: postOperation,
      onPostOperationError,
    } as any);
    const iterator = (fetcher({ query: '{ value }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await iterator.next();
    await nextMicrotask();
    await iterator.return?.();
    await nextMicrotask();

    expect(postOperation).toHaveBeenCalledOnce();
    expect(onPostOperationError).toHaveBeenCalledOnce();
    expect(onPostOperationError).toHaveBeenCalledWith(failure);
  });

  it('keeps the partial response visible and never completes on premature EOF', async () => {
    const snapshots: unknown[] = [];
    const timings: RequestTiming[] = [];
    const postOperation = vi.fn();
    const baseFetcher = (() => stream({ data: { partial: true }, hasNext: true })) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onResponse: (snapshot) => snapshots.push(snapshot),
      onTiming: (timing) => timings.push(timing),
      executePostOperation: postOperation,
    });

    await expect(collect(fetcher({ query: '{ partial }' }))).rejects.toMatchObject({ code: 'PREMATURE_EOF' });

    expect(snapshots).toEqual([{ data: { partial: true } }]);
    expect(timings.at(-1)).toMatchObject({ inFlight: false, state: 'incomplete', partCount: 1 });
    expect(postOperation).not.toHaveBeenCalled();
  });

  it('suppresses hidden premature EOF delivery while retaining incomplete timing on its origin', async () => {
    let visible = true;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const timings: RequestTiming[] = [];
    const baseFetcher = (() =>
      (async function* () {
        yield { data: { partial: true }, hasNext: true };
        await finished;
      })()) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => ({
        isCurrent: () => true,
        isVisible: () => visible,
        tabId: () => 'tab-a',
      }),
      onTiming: (timing) => timings.push(timing),
    });
    const iterator = (fetcher({ query: '{ partial }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await iterator.next();
    visible = false;
    finish();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(timings.at(-1)).toMatchObject({ state: 'incomplete', inFlight: false, partCount: 1 });
  });

  it('suppresses superseded premature EOF delivery and records cancellation on its origin', async () => {
    let activeTabId = 'tab-a';
    let finishOld!: () => void;
    const oldFinished = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const tracker = createTabExecutionTracker(() => activeTabId);
    const timingByOrigin: { state: RequestTiming['state']; tabId?: string }[] = [];
    const baseFetcher = ((request: { query: string }) =>
      request.query === 'old'
        ? (async function* () {
            yield { data: { partial: true }, hasNext: true };
            await oldFinished;
          })()
        : stream({ data: { current: true } })) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => tracker.begin(),
      onTiming: (timing, scope) => timingByOrigin.push({ state: timing.state, tabId: scope?.tabId?.() }),
    });
    const oldIterator = (fetcher({ query: 'old' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await oldIterator.next();
    activeTabId = 'tab-b';
    await collect(fetcher({ query: 'new' }));
    finishOld();

    await expect(oldIterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(timingByOrigin.at(-1)).toEqual({ state: 'cancelled', tabId: 'tab-a' });
  });

  it('suppresses a hidden rejected fetcher promise while retaining its error timing', async () => {
    let visible = true;
    let rejectRequest!: (error: Error) => void;
    const result = new Promise<unknown>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const timings: RequestTiming[] = [];
    const fetcher = createObservedPlaygroundFetcher((() => result) as Fetcher, {
      beginExecution: () => ({
        isCurrent: () => true,
        isVisible: () => visible,
        tabId: () => 'tab-a',
      }),
      onTiming: (timing) => timings.push(timing),
    });
    const pending = fetcher({ query: '{ value }' }) as Promise<unknown>;

    visible = false;
    rejectRequest(new Error('network failed'));

    const suppressed = await pending;
    await expect(collect(suppressed)).resolves.toEqual([]);
    expect(timings.at(-1)).toMatchObject({ state: 'error', inFlight: false });
  });

  it('preserves a rejected fetcher promise for the active execution', async () => {
    const failure = new Error('active request failed');
    const timings: RequestTiming[] = [];
    const fetcher = createObservedPlaygroundFetcher((() => Promise.reject(failure)) as Fetcher, {
      onTiming: (timing) => timings.push(timing),
    });

    await expect(fetcher({ query: '{ value }' })).rejects.toBe(failure);
    expect(timings.at(-1)).toMatchObject({ state: 'error', inFlight: false });
  });

  it('reports a real transport rejection as an execution error', async () => {
    const timings: RequestTiming[] = [];
    const httpFetch = createPlaygroundHTTPFetch({
      fetchImplementation: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')),
      schema: null,
      clientValidationEnabled: false,
      runPreOperation: vi.fn(),
    });
    const baseFetcher = ((request: { query: string }) =>
      httpFetch(new URL('https://router.example/graphql'), {
        method: 'POST',
        headers: {},
        body: JSON.stringify(request),
      }).then((response) => response.json())) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onTiming: (timing) => timings.push(timing),
    });

    await expect(fetcher({ query: '{ value }' })).rejects.toThrow('Failed to fetch from router due to network errors');
    expect(timings.at(-1)).toMatchObject({ state: 'error', inFlight: false });
  });

  it('suppresses a superseded rejected fetcher promise and records cancellation on its origin', async () => {
    let activeTabId = 'tab-a';
    let rejectOld!: (error: Error) => void;
    const oldResult = new Promise<unknown>((_resolve, reject) => {
      rejectOld = reject;
    });
    const tracker = createTabExecutionTracker(() => activeTabId);
    const timingByOrigin: { state: RequestTiming['state']; tabId?: string }[] = [];
    const baseFetcher = ((request: { query: string }) =>
      request.query === 'old' ? oldResult : stream({ data: { current: true } })) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => tracker.begin(),
      onTiming: (timing, scope) => timingByOrigin.push({ state: timing.state, tabId: scope?.tabId?.() }),
    });
    const pendingOld = fetcher({ query: 'old' }) as Promise<unknown>;

    activeTabId = 'tab-b';
    await collect(fetcher({ query: 'new' }));
    rejectOld(new Error('old request failed'));

    const suppressed = await pendingOld;
    await expect(collect(suppressed)).resolves.toEqual([]);
    expect(timingByOrigin.at(-1)).toEqual({ state: 'cancelled', tabId: 'tab-a' });
  });

  it('keeps the partial response visible and never completes when iteration is cancelled', async () => {
    const snapshots: unknown[] = [];
    const timings: RequestTiming[] = [];
    const postOperation = vi.fn();
    const baseFetcher = (() =>
      (async function* () {
        yield { data: { partial: true }, hasNext: true };
        await new Promise(() => {});
      })()) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onResponse: (snapshot) => snapshots.push(snapshot),
      onTiming: (timing) => timings.push(timing),
      executePostOperation: postOperation,
    });
    const iterator = (fetcher({ query: '{ partial }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(snapshots).toEqual([{ data: { partial: true } }]);
    expect(timings.at(-1)).toMatchObject({ inFlight: false, state: 'cancelled', partCount: 1 });
    expect(postOperation).not.toHaveBeenCalled();
  });

  it('does not let an older stream overwrite or complete after a newer execution starts', async () => {
    let activeTabId = 'tab-a';
    const tracker = createTabExecutionTracker(() => activeTabId);
    let releaseOld!: () => void;
    const oldTerminalReady = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const baseFetcher = ((request: { query: string }) => {
      if (request.query === 'old') {
        return (async function* () {
          yield { data: { source: 'old-partial' }, pending: [{ id: 'old', path: [] }], hasNext: true };
          await oldTerminalReady;
          yield {
            incremental: [{ id: 'old', data: { source: 'old-terminal' } }],
            completed: [{ id: 'old' }],
            hasNext: false,
          };
        })();
      }
      return stream({ data: { source: 'new' } });
    }) as Fetcher;
    const snapshots: unknown[] = [];
    const timingByOrigin: { state: RequestTiming['state']; tabId?: string }[] = [];
    const postOperation = vi.fn();
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => tracker.begin(),
      onResponse: (snapshot) => snapshots.push(snapshot),
      onTiming: (timing, scope) => timingByOrigin.push({ state: timing.state, tabId: scope?.tabId?.() }),
      executePostOperation: postOperation,
    });
    const oldIterator = (fetcher({ query: 'old' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await oldIterator.next();
    activeTabId = 'tab-b';
    await collect(fetcher({ query: 'new' }));
    releaseOld();
    await oldIterator.next();
    await oldIterator.next();
    await nextMicrotask();

    expect(snapshots).toEqual([{ data: { source: 'old-partial' } }, { data: { source: 'new' } }]);
    expect(postOperation).toHaveBeenCalledOnce();
    expect(postOperation).toHaveBeenCalledWith({ query: 'new' }, { data: { source: 'new' } });
    expect(timingByOrigin.at(-1)).toEqual({ state: 'cancelled', tabId: 'tab-a' });
  });

  it('invalidates the previous execution when a subscription starts', async () => {
    let releaseOld!: () => void;
    const oldTerminalReady = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const baseFetcher = ((request: { query: string }) => {
      if (request.query.startsWith('subscription')) {
        return { data: { ping: true } };
      }
      return (async function* () {
        yield { data: { source: 'old-partial' }, pending: [{ id: 'old', path: [] }], hasNext: true };
        await oldTerminalReady;
        yield {
          incremental: [{ id: 'old', data: { source: 'old-terminal' } }],
          completed: [{ id: 'old' }],
          hasNext: false,
        };
      })();
    }) as Fetcher;
    const postOperation = vi.fn();
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      executePostOperation: postOperation,
    });
    const oldIterator = (fetcher({ query: 'query Old { value }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await oldIterator.next();
    fetcher({ query: 'subscription Live { ping }' });
    releaseOld();

    await expect(oldIterator.next()).resolves.toEqual({ done: true, value: undefined });
    await nextMicrotask();
    expect(postOperation).not.toHaveBeenCalled();
  });

  it('does not deliver subscription events after the originating tab becomes hidden', async () => {
    let activeTabId = 'tab-a';
    let releaseNext!: () => void;
    const nextReady = new Promise<void>((resolve) => {
      releaseNext = resolve;
    });
    const tracker = createTabExecutionTracker(() => activeTabId);
    const baseFetcher = (() =>
      (async function* () {
        yield { data: { event: 'first' } };
        await nextReady;
        yield { data: { event: 'hidden' } };
      })()) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => tracker.begin(),
    });
    const iterator = (fetcher({ query: 'subscription Live { event }' }) as AsyncIterable<unknown>)[
      Symbol.asyncIterator
    ]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { event: 'first' } } });
    activeTabId = 'tab-b';
    releaseNext();

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it('stops yielding and completing an execution after its tab becomes inactive', async () => {
    let activeTab = 'tab-a';
    let releaseTerminal!: () => void;
    const terminalReady = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const baseFetcher = (() =>
      (async function* () {
        yield { data: { source: 'partial' }, pending: [{ id: 'slow', path: [] }], hasNext: true };
        await terminalReady;
        yield {
          incremental: [{ id: 'slow', data: { source: 'terminal' } }],
          completed: [{ id: 'slow' }],
          hasNext: false,
        };
      })()) as Fetcher;
    const snapshots: unknown[] = [];
    const postOperation = vi.fn();
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => {
        const executionTab = activeTab;
        return () => executionTab === activeTab;
      },
      onResponse: (snapshot) => snapshots.push(snapshot),
      executePostOperation: postOperation,
    });
    const iterator = (fetcher({ query: 'old tab' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { data: { source: 'partial' } } });
    activeTab = 'tab-b';
    releaseTerminal();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await nextMicrotask();

    expect(snapshots).toEqual([{ data: { source: 'partial' } }]);
    expect(postOperation).not.toHaveBeenCalled();
  });

  it('classifies a hidden terminal payload as cancelled without running post-operation work', async () => {
    let visible = true;
    let releaseTerminal!: () => void;
    const terminalReady = new Promise<void>((resolve) => {
      releaseTerminal = resolve;
    });
    const baseFetcher = (() =>
      (async function* () {
        yield { data: { source: 'partial' }, pending: [{ id: 'slow', path: [] }], hasNext: true };
        await terminalReady;
        yield {
          incremental: [{ id: 'slow', data: { source: 'terminal' } }],
          completed: [{ id: 'slow' }],
          hasNext: false,
        };
      })()) as Fetcher;
    const timings: RequestTiming[] = [];
    const postOperation = vi.fn();
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => ({
        isCurrent: () => true,
        isVisible: () => visible,
        tabId: () => 'tab-a',
      }),
      onTiming: (timing) => timings.push(timing),
      executePostOperation: postOperation,
    });
    const iterator = (fetcher({ query: 'query Origin { value }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { data: { source: 'partial' } } });
    visible = false;
    releaseTerminal();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await nextMicrotask();

    expect(timings.at(-1)).toMatchObject({ inFlight: false, state: 'cancelled', partCount: 2 });
    expect(postOperation).not.toHaveBeenCalled();
  });

  it('reports cancellation to the originating tab after that tab becomes hidden', async () => {
    let visible = true;
    const timings: RequestTiming[] = [];
    const timingOrigins: string[] = [];
    const baseFetcher = (() =>
      (async function* () {
        yield { data: { source: 'partial' }, pending: [{ id: 'slow', path: [] }], hasNext: true };
        await new Promise(() => {});
      })()) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => ({
        isCurrent: () => true,
        isVisible: () => visible,
        tabId: () => 'tab-a',
      }),
      onTiming: ((timing: RequestTiming, scope: { tabId?: () => string }) => {
        timings.push(timing);
        timingOrigins.push(scope.tabId?.() ?? 'missing');
      }) as any,
    } as any);
    const iterator = (fetcher({ query: 'query Origin { value }' }) as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await iterator.next();
    visible = false;
    await iterator.return?.();

    expect(timings.at(-1)).toMatchObject({ inFlight: false, state: 'cancelled', partCount: 1 });
    expect(timingOrigins.at(-1)).toBe('tab-a');
  });

  it('does not observe introspection operations', async () => {
    const response = { data: { __schema: {} } };
    const onResponse = vi.fn();
    const postOperation = vi.fn();
    const baseFetcher = vi.fn(() => response) as Fetcher;
    const fetcher = createObservedPlaygroundFetcher(baseFetcher, {
      onResponse,
      executePostOperation: postOperation,
    });

    expect(
      fetcher({ query: 'query IntrospectionQuery { __schema { description } }', operationName: 'IntrospectionQuery' }),
    ).toBe(response);
    await nextMicrotask();

    expect(onResponse).not.toHaveBeenCalled();
    expect(postOperation).not.toHaveBeenCalled();
  });
});

describe('getActiveTabExecution', () => {
  it('takes query, headers, and response from the active GraphiQL tab', () => {
    const tabsState = {
      activeTabIndex: 0,
      tabs: [
        {
          id: 'tab-a',
          hash: 'a',
          title: 'A',
          operationName: 'A',
          query: 'query A { a }',
          variables: '{}',
          headers: '{"x-tab":"a"}',
          response: '{"data":{"a":true}}',
        },
        {
          id: 'tab-b',
          hash: 'b',
          title: 'B',
          operationName: 'B',
          query: 'query B { b }',
          variables: '{}',
          headers: '{"x-tab":"b"}',
          response: '{"data":{"b":true}}',
        },
      ],
    };

    expect(getActiveTabExecution(tabsState, { query: 'fallback', headers: '{}' })).toEqual({
      id: 'tab-a',
      query: 'query A { a }',
      headers: '{"x-tab":"a"}',
      variables: '{}',
      operationName: 'A',
      response: '{"data":{"a":true}}',
    });
    tabsState.activeTabIndex = 1;
    expect(getActiveTabExecution(tabsState, { query: 'fallback', headers: '{}' })).toEqual({
      id: 'tab-b',
      query: 'query B { b }',
      headers: '{"x-tab":"b"}',
      variables: '{}',
      operationName: 'B',
      response: '{"data":{"b":true}}',
    });
  });

  it('moves state recorded before GraphiQL exposes its first tab ID', () => {
    const initial = {
      __unbound_playground_tab__: { state: 'complete' as const, inFlight: false, partCount: 1 },
      existing: { state: 'streaming' as const, inFlight: true, partCount: 2 },
    };

    expect(bindInitialTabState(initial, 'first-real-tab')).toEqual({
      'first-real-tab': { state: 'complete', inFlight: false, partCount: 1 },
      existing: { state: 'streaming', inFlight: true, partCount: 2 },
    });
    expect(initial).toHaveProperty('__unbound_playground_tab__');
  });

  it('uses one global user-operation generation while retaining each origin tab', () => {
    let activeTabId: string | undefined;
    const tracker = createTabExecutionTracker(() => activeTabId);

    const initial = tracker.begin();
    activeTabId = 'tab-a';
    expect(initial.tabId()).toBe('tab-a');
    expect(initial.isCurrent()).toBe(true);
    expect(initial.isVisible()).toBe(true);

    activeTabId = 'tab-b';
    const tabB = tracker.begin();
    expect(initial.isCurrent()).toBe(false);
    expect(initial.isOriginCurrent()).toBe(true);
    expect(initial.isVisible()).toBe(false);
    expect(tabB.isCurrent()).toBe(true);
    expect(tabB.isVisible()).toBe(true);

    activeTabId = 'tab-a';
    const tabAReplacement = tracker.begin();
    expect(initial.isCurrent()).toBe(false);
    expect(initial.isOriginCurrent()).toBe(false);
    expect(tabAReplacement.isCurrent()).toBe(true);
    expect(tabB.isCurrent()).toBe(false);
    expect(tabB.isOriginCurrent()).toBe(true);
    expect(tabB.tabId()).toBe('tab-b');
  });
});
