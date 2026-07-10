import { describe, expect, it, vi } from 'vitest';

import {
  IncrementalProtocolError,
  observeIncrementalResult,
  type FetcherLikeResult,
} from '../src/playground/incremental-delivery';

async function* stream(...chunks: unknown[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect(result: FetcherLikeResult): Promise<unknown[]> {
  expect(result).toBeTruthy();
  expect(typeof result).toBe('object');
  expect(Symbol.asyncIterator in (result as object)).toBe(true);

  const snapshots: unknown[] = [];
  for await (const snapshot of result as AsyncIterable<unknown>) {
    snapshots.push(snapshot);
  }
  return snapshots;
}

async function collectUntilError(result: FetcherLikeResult) {
  const snapshots: unknown[] = [];
  let error: unknown;
  try {
    for await (const snapshot of result as AsyncIterable<unknown>) {
      snapshots.push(snapshot);
    }
  } catch (caught) {
    error = caught;
  }
  return { snapshots, error };
}

describe('observeIncrementalResult', () => {
  it('assembles a 20220824 ID patch at its pending path and subPath', async () => {
    const result = observeIncrementalResult(
      stream(
        {
          data: { viewer: { aliasedFriends: [{ id: '1' }] } },
          pending: [{ id: 'profile', path: ['viewer', 'aliasedFriends', 0] }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'profile', subPath: ['profile'], data: { bio: 'Hello' } }],
          completed: [{ id: 'profile' }],
          hasNext: false,
        },
      ),
      {},
    );

    await expect(collect(result)).resolves.toEqual([
      { data: { viewer: { aliasedFriends: [{ id: '1' }] } } },
      { data: { viewer: { aliasedFriends: [{ id: '1', profile: { bio: 'Hello' } }] } } },
    ]);
  });

  it('registers nested pending IDs before applying entries from the same part', async () => {
    const result = observeIncrementalResult(
      stream(
        {
          data: { viewer: { id: '1' } },
          pending: [{ id: 'details', path: ['viewer'] }],
          hasNext: true,
        },
        {
          pending: [{ id: 'biography', path: ['viewer', 'details'] }],
          incremental: [{ id: 'details', data: { details: { age: 42 } } }],
          completed: [{ id: 'details' }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'biography', data: { biography: 'Ada' } }],
          completed: [{ id: 'biography' }],
          hasNext: false,
        },
      ),
      {},
    );

    const snapshots = await collect(result);
    expect(snapshots.at(-1)).toEqual({
      data: { viewer: { id: '1', details: { age: 42, biography: 'Ada' } } },
    });
  });

  it('merges root and sibling defers in arrival order', async () => {
    const result = observeIncrementalResult(
      stream(
        {
          data: { immediate: true },
          pending: [
            { id: 'left', path: [] },
            { id: 'right', path: [] },
          ],
          hasNext: true,
        },
        {
          incremental: [{ id: 'right', data: { right: 2 } }],
          completed: [{ id: 'right' }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'left', data: { left: 1 } }],
          completed: [{ id: 'left' }],
          hasNext: false,
        },
      ),
      {},
    );

    await expect(collect(result)).resolves.toEqual([
      { data: { immediate: true } },
      { data: { immediate: true, right: 2 } },
      { data: { immediate: true, right: 2, left: 1 } },
    ]);
  });

  it('supports legacy path-based patches with aliases and numeric list segments', async () => {
    const result = observeIncrementalResult(
      stream(
        { data: { aliasedUsers: [{ name: 'Ada' }, {}] }, hasNext: true },
        {
          incremental: [{ path: ['aliasedUsers', 1], data: { name: 'Grace' } }],
          hasNext: false,
        },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({
      data: { aliasedUsers: [{ name: 'Ada' }, { name: 'Grace' }] },
    });
  });

  it('supports legacy top-level path and items payloads', async () => {
    const result = observeIncrementalResult(
      stream(
        {
          data: { viewer: { immediate: true }, values: ['a', 'd'] },
          extensions: { preserved: true },
          hasNext: true,
        },
        {
          data: { deferred: true },
          path: ['viewer'],
          errors: [{ message: 'legacy', extensions: { code: 'LEGACY' } }],
          extensions: { legacy: true },
          hasNext: true,
        },
        { items: ['b', 'c'], path: ['values', 1], hasNext: false },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({
      data: { viewer: { immediate: true, deferred: true }, values: ['a', 'b', 'c', 'd'] },
      errors: [{ message: 'legacy', extensions: { code: 'LEGACY' } }],
      extensions: { preserved: true, legacy: true },
    });
  });

  it('inserts streamed items at their path index, including empty and null items', async () => {
    const result = observeIncrementalResult(
      stream(
        { data: { values: ['a', 'd'], initiallyEmpty: [] }, hasNext: true },
        {
          incremental: [
            { path: ['values', 1], items: ['b', null] },
            { path: ['initiallyEmpty', 0], items: [] },
            { path: ['initiallyEmpty', 0], items: [null] },
          ],
          hasNext: false,
        },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({
      data: { values: ['a', 'b', null, 'd'], initiallyEmpty: [null] },
    });
  });

  it('preserves data when it is explicitly null', async () => {
    const result = observeIncrementalResult(stream({ data: null, hasNext: false }), {});

    await expect(collect(result)).resolves.toEqual([{ data: null }]);
  });

  it('flattens multiple meros parts in one yielded incremental batch', async () => {
    const result = observeIncrementalResult(
      stream([
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
      ]),
      {},
    );

    await expect(collect(result)).resolves.toEqual([{ data: { fast: true } }, { data: { fast: true, slow: true } }]);
  });

  it('passes plain values, promises, and observables through unchanged', async () => {
    const plain = { data: { value: 1 }, extensions: { source: 'plain' } };
    const promise = Promise.resolve(plain);
    const observable = { subscribe: () => undefined };

    expect(observeIncrementalResult(plain, {})).toBe(plain);
    await expect(observeIncrementalResult(promise, {})).resolves.toBe(plain);
    expect(observeIncrementalResult(observable, {})).toBe(observable);
  });

  it('passes subscription payloads and batched non-incremental results through without flattening', async () => {
    const first = { data: { event: 1 }, extensions: { source: 'subscription' } };
    const batch = [{ data: { event: 2 } }, { data: { event: 3 } }];
    const result = observeIncrementalResult(stream(first, batch), {});

    await expect(collect(result)).resolves.toEqual([first, batch]);
  });

  it('accumulates initial, incremental, and completion errors with extensions intact', async () => {
    const initialError = { message: 'Initial', extensions: { code: 'INITIAL' } };
    const incrementalError = { message: 'Incremental', extensions: { code: 'INCREMENTAL' } };
    const completionError = { message: 'Completed', extensions: { code: 'COMPLETED' } };
    const result = observeIncrementalResult(
      stream(
        {
          data: { viewer: {} },
          errors: [initialError],
          pending: [{ id: 'slow', path: ['viewer'] }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'slow', data: { slow: null }, errors: [incrementalError] }],
          completed: [{ id: 'slow', errors: [completionError] }],
          hasNext: false,
        },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({
      data: { viewer: { slow: null } },
      errors: [initialError, incrementalError, completionError],
    });
  });

  it('shallow-merges top-level and entry extensions while replacing terminal trace', async () => {
    const result = observeIncrementalResult(
      stream(
        {
          data: { fast: true },
          extensions: { trace: { partial: true }, preserved: 'initial' },
          pending: [{ id: 'slow', path: [] }],
          hasNext: true,
        },
        {
          incremental: [
            {
              id: 'slow',
              data: { slow: true },
              extensions: { entryOnly: true, conflict: 'entry' },
            },
          ],
          completed: [{ id: 'slow' }],
          extensions: { trace: { complete: true }, topOnly: true, conflict: 'top' },
          hasNext: false,
        },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({
      data: { fast: true, slow: true },
      extensions: {
        trace: { complete: true },
        preserved: 'initial',
        topOnly: true,
        entryOnly: true,
        conflict: 'entry',
      },
    });
  });

  it('applies an incremental data value when it is explicitly null', async () => {
    const result = observeIncrementalResult(
      stream(
        { data: { viewer: { slow: { value: true } } }, hasNext: true },
        { incremental: [{ path: ['viewer', 'slow'], data: null }], hasNext: false },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({ data: { viewer: { slow: null } } });
  });

  it('rejects an unknown pending ID without merging the patch at the root', async () => {
    const incomplete: unknown[] = [];
    const errors: unknown[] = [];
    const result = observeIncrementalResult(
      stream(
        { data: { safe: true }, hasNext: true },
        { incremental: [{ id: 'missing', data: { unsafe: true } }], hasNext: false },
      ),
      {
        onIncomplete: (error) => incomplete.push(error),
        onError: (error) => errors.push(error),
      },
    );

    const observed = await collectUntilError(result);
    expect(observed.snapshots).toEqual([{ data: { safe: true } }]);
    expect(observed.error).toBeInstanceOf(IncrementalProtocolError);
    expect(observed.error).toMatchObject({ code: 'UNKNOWN_PENDING_ID', pendingId: 'missing', partCount: 2 });
    expect(incomplete).toEqual([observed.error]);
    expect(errors).toEqual([observed.error]);
  });

  it('rejects duplicate live pending IDs', async () => {
    const result = observeIncrementalResult(
      stream({
        data: {},
        pending: [
          { id: 'same', path: [] },
          { id: 'same', path: ['nested'] },
        ],
        hasNext: true,
      }),
      {},
    );

    const observed = await collectUntilError(result);
    expect(observed.snapshots).toEqual([]);
    expect(observed.error).toMatchObject({ code: 'DUPLICATE_PENDING_ID', pendingId: 'same', partCount: 1 });
  });

  it('rejects duplicate completion entries', async () => {
    const result = observeIncrementalResult(
      stream(
        { data: {}, pending: [{ id: 'same', path: [] }], hasNext: true },
        { completed: [{ id: 'same' }, { id: 'same' }], hasNext: false },
      ),
      {},
    );

    const observed = await collectUntilError(result);
    expect(observed.snapshots).toEqual([{ data: {} }]);
    expect(observed.error).toMatchObject({ code: 'DUPLICATE_COMPLETION', pendingId: 'same', partCount: 2 });
  });

  it('rejects patches received after their pending ID completed', async () => {
    const result = observeIncrementalResult(
      stream(
        { data: { safe: true }, pending: [{ id: 'done', path: [] }], hasNext: true },
        { completed: [{ id: 'done' }], hasNext: true },
        { incremental: [{ id: 'done', data: { unsafe: true } }], hasNext: false },
      ),
      {},
    );

    const observed = await collectUntilError(result);
    expect(observed.snapshots).toEqual([{ data: { safe: true } }, { data: { safe: true } }]);
    expect(observed.error).toMatchObject({ code: 'PATCH_AFTER_COMPLETION', pendingId: 'done', partCount: 3 });
  });

  it('reports start, first result, snapshots, and terminal progress in order', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(125).mockReturnValueOnce(175);
    const events: Array<{ name: string; progress: unknown }> = [];
    const result = observeIncrementalResult(
      stream(
        { data: { fast: true }, pending: [{ id: 'slow', path: [] }], hasNext: true },
        {
          incremental: [{ id: 'slow', data: { slow: true } }],
          completed: [{ id: 'slow' }],
          hasNext: false,
        },
      ),
      {
        onStart: (progress) => events.push({ name: 'start', progress }),
        onFirstResult: (_snapshot, progress) => events.push({ name: 'first', progress }),
        onSnapshot: (_snapshot, progress) => events.push({ name: 'snapshot', progress }),
        onComplete: (_snapshot, progress) => events.push({ name: 'complete', progress }),
      },
    );

    expect(events).toEqual([{ name: 'start', progress: { hasNext: undefined, partCount: 0 } }]);
    const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    await iterator.next();
    expect(events.map((event) => event.name)).toEqual(['start', 'first', 'snapshot']);
    expect(events.at(-1)?.progress).toEqual({ hasNext: true, partCount: 1, firstResultTimeMs: 25 });

    await iterator.next();
    expect(events.map((event) => event.name)).toEqual(['start', 'first', 'snapshot', 'snapshot']);
    expect(events.at(-1)?.progress).toEqual({
      hasNext: false,
      partCount: 2,
      firstResultTimeMs: 25,
      totalDurationMs: 75,
    });

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await Promise.resolve();
    expect(events.map((event) => event.name)).toEqual(['start', 'first', 'snapshot', 'snapshot', 'complete']);
    expect(events.at(-1)?.progress).toEqual({
      hasNext: false,
      partCount: 2,
      firstResultTimeMs: 25,
      totalDurationMs: 75,
    });
    now.mockRestore();
  });

  it('completes a plain result once without changing its identity', async () => {
    const plain = { data: { value: true } };
    const events: string[] = [];
    const result = observeIncrementalResult(plain, {
      onStart: () => events.push('start'),
      onFirstResult: () => events.push('first'),
      onSnapshot: () => events.push('snapshot'),
      onComplete: () => events.push('complete'),
    });

    expect(result).toBe(plain);
    expect(events).toEqual(['start', 'first', 'snapshot']);
    await Promise.resolve();
    expect(events).toEqual(['start', 'first', 'snapshot', 'complete']);
  });

  it('does not await completion side effects and reports their rejection without replacing the result', async () => {
    const completionError = new Error('analytics failed');
    const errors: unknown[] = [];
    const result = observeIncrementalResult(stream({ data: { value: true }, hasNext: false }), {
      onComplete: () => Promise.reject(completionError),
      onError: (error) => errors.push(error),
    });
    const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { value: true } } });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toEqual([completionError]);
  });

  it('raises premature EOF and never completes when hasNext remains true', async () => {
    const completed: unknown[] = [];
    const incomplete: unknown[] = [];
    const errors: unknown[] = [];
    const result = observeIncrementalResult(stream({ data: { partial: true }, hasNext: true }), {
      onComplete: (value) => completed.push(value),
      onIncomplete: (error) => incomplete.push(error),
      onError: (error) => errors.push(error),
    });

    const observed = await collectUntilError(result);
    expect(observed.snapshots).toEqual([{ data: { partial: true } }]);
    expect(observed.error).toMatchObject({ code: 'PREMATURE_EOF', partCount: 1 });
    expect(incomplete).toEqual([observed.error]);
    expect(errors).toEqual([observed.error]);
    expect(completed).toEqual([]);
  });

  it('reports cancellation when the consumer stops an incremental stream early', async () => {
    const cancelled: unknown[] = [];
    const completed: unknown[] = [];
    const result = observeIncrementalResult(
      stream({ data: { partial: true }, hasNext: true }, { data: { unreachable: true }, hasNext: false }),
      {
        onCancel: (progress) => cancelled.push(progress),
        onComplete: (value) => completed.push(value),
      },
    );
    const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ hasNext: true, partCount: 1 });
    expect(completed).toEqual([]);
  });

  it('isolates snapshot callback failures from the streamed result', async () => {
    const result = observeIncrementalResult(stream({ data: { value: true }, hasNext: false }), {
      onSnapshot: () => {
        throw new Error('view was unmounted');
      },
    });

    await expect(collect(result)).resolves.toEqual([{ data: { value: true } }]);
  });

  it('preserves backpressure while flattening a multipart batch', async () => {
    let sourcePulls = 0;
    async function* batchedStream() {
      sourcePulls++;
      yield [
        { data: { fast: true }, pending: [{ id: 'slow', path: [] }], hasNext: true },
        {
          incremental: [{ id: 'slow', data: { slow: true } }],
          completed: [{ id: 'slow' }],
          hasNext: false,
        },
      ];
      sourcePulls++;
      yield { data: { mustNotBePulled: true }, hasNext: false };
    }
    const result = observeIncrementalResult(batchedStream(), {});
    const iterator = (result as AsyncIterable<unknown>)[Symbol.asyncIterator]();

    expect(sourcePulls).toBe(0);
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { data: { fast: true } } });
    expect(sourcePulls).toBe(1);
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { data: { fast: true, slow: true } },
    });
    expect(sourcePulls).toBe(1);
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    expect(sourcePulls).toBe(1);
  });

  it('observes a promised plain result from request start through completion', async () => {
    const plain = { data: { promised: true } };
    const events: string[] = [];
    const result = observeIncrementalResult(Promise.resolve(plain), {
      onStart: () => events.push('start'),
      onFirstResult: () => events.push('first'),
      onSnapshot: () => events.push('snapshot'),
      onComplete: () => events.push('complete'),
    });

    expect(events).toEqual(['start']);
    await expect(result).resolves.toBe(plain);
    expect(events.slice(0, 3)).toEqual(['start', 'first', 'snapshot']);
    await Promise.resolve();
    expect(events).toEqual(['start', 'first', 'snapshot', 'complete']);
  });

  it('reports a rejected fetcher promise without marking it incomplete', async () => {
    const fetchError = new Error('network failed');
    const errors: unknown[] = [];
    const incomplete: unknown[] = [];
    const result = observeIncrementalResult(Promise.reject(fetchError), {
      onError: (error) => errors.push(error),
      onIncomplete: (error) => incomplete.push(error),
    });

    await expect(result).rejects.toBe(fetchError);
    expect(errors).toEqual([fetchError]);
    expect(incomplete).toEqual([]);
  });

  it('reports an aborted underlying stream as cancellation', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    async function* abortedStream() {
      yield { data: { partial: true }, hasNext: true };
      throw abort;
    }
    const cancellations: unknown[] = [];
    const errors: unknown[] = [];
    const result = observeIncrementalResult(abortedStream(), {
      onCancel: (progress) => cancellations.push(progress),
      onError: (error) => errors.push(error),
    });

    const observed = await collectUntilError(result);
    expect(observed.error).toBe(abort);
    expect(cancellations).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('supports ID-based streamed items with numeric subPaths', async () => {
    const result = observeIncrementalResult(
      stream(
        {
          data: { values: ['a', 'd'] },
          pending: [{ id: 'values', path: ['values'] }],
          hasNext: true,
        },
        {
          incremental: [{ id: 'values', subPath: [1], items: ['b', 'c'] }],
          completed: [{ id: 'values' }],
          hasNext: false,
        },
      ),
      {},
    );

    expect((await collect(result)).at(-1)).toEqual({ data: { values: ['a', 'b', 'c', 'd'] } });
  });
});
