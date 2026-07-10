import type { GraphQLFormattedError } from 'graphql';

export type IncrementalPathSegment = string | number;

export type PendingEntry = {
  id: string;
  path?: readonly IncrementalPathSegment[];
  label?: string;
};

export type IncrementalEntry = {
  id?: string;
  path?: readonly IncrementalPathSegment[];
  subPath?: readonly IncrementalPathSegment[];
  label?: string;
  data?: unknown;
  items?: readonly unknown[];
  errors?: readonly GraphQLFormattedError[];
  extensions?: Record<string, unknown>;
};

export type CompletedEntry = {
  id: string;
  errors?: readonly GraphQLFormattedError[];
};

export type IncrementalSnapshot = {
  data?: unknown;
  errors?: readonly GraphQLFormattedError[];
  extensions?: Record<string, unknown>;
};

export type InitialIncrementalPayload = IncrementalSnapshot & {
  pending?: readonly PendingEntry[];
  incremental?: readonly IncrementalEntry[];
  completed?: readonly CompletedEntry[];
  hasNext?: boolean;
};

export type ObservableLike<T> = {
  subscribe(next?: (value: T) => void, error?: (error: unknown) => void, complete?: () => void): unknown;
};

export type FetcherLikeValue =
  | IncrementalSnapshot
  | readonly IncrementalSnapshot[]
  | AsyncIterable<InitialIncrementalPayload | readonly InitialIncrementalPayload[]>
  | ObservableLike<IncrementalSnapshot>;

export type FetcherLikeResult = FetcherLikeValue | PromiseLike<FetcherLikeValue>;

export type IncrementalProgress = {
  hasNext?: boolean;
  partCount: number;
  firstResultTimeMs?: number;
  totalDurationMs?: number;
};

export type IncrementalProtocolErrorCode =
  | 'UNKNOWN_PENDING_ID'
  | 'DUPLICATE_PENDING_ID'
  | 'DUPLICATE_COMPLETION'
  | 'PATCH_AFTER_COMPLETION'
  | 'PREMATURE_EOF';

export class IncrementalProtocolError extends Error {
  readonly code: IncrementalProtocolErrorCode;
  readonly pendingId?: string;
  readonly partCount: number;

  constructor(code: IncrementalProtocolErrorCode, message: string, details: { pendingId?: string; partCount: number }) {
    super(message);
    this.name = 'IncrementalProtocolError';
    this.code = code;
    this.pendingId = details.pendingId;
    this.partCount = details.partCount;
  }
}

export type IncrementalObserver = {
  onStart?(progress: IncrementalProgress): void;
  onFirstResult?(result: IncrementalSnapshot, progress: IncrementalProgress): void;
  onSnapshot?(result: IncrementalSnapshot, progress: IncrementalProgress): void;
  onComplete?(result: IncrementalSnapshot, progress: IncrementalProgress): void | Promise<void>;
  onIncomplete?(error: IncrementalProtocolError, progress: IncrementalProgress): void;
  onError?(error: unknown, progress: IncrementalProgress): void;
  onCancel?(progress: IncrementalProgress): void;
};

const isIncrementalPayload = (value: unknown): value is InitialIncrementalPayload =>
  !!value &&
  typeof value === 'object' &&
  ('hasNext' in value || 'pending' in value || 'incremental' in value || 'completed' in value);

const isIncrementalBatch = (
  value: InitialIncrementalPayload | readonly InitialIncrementalPayload[],
): value is readonly InitialIncrementalPayload[] => Array.isArray(value);

const isResultBatch = (
  value: IncrementalSnapshot | readonly IncrementalSnapshot[],
): value is readonly IncrementalSnapshot[] => Array.isArray(value);

const clone = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => clone(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
};

const mergeObject = (target: Record<string, unknown>, source: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (
      current &&
      value &&
      typeof current === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      mergeObject(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = clone(value);
    }
  }
};

const mergeDataAtPath = (assembled: IncrementalSnapshot, path: readonly IncrementalPathSegment[], data: unknown) => {
  if (path.length === 0) {
    if (assembled.data && typeof assembled.data === 'object' && data && typeof data === 'object') {
      mergeObject(assembled.data as Record<string, unknown>, data as Record<string, unknown>);
    } else {
      assembled.data = clone(data);
    }
    return;
  }

  let parent = assembled.data as Record<IncrementalPathSegment, unknown>;
  for (const segment of path.slice(0, -1)) {
    parent = parent[segment] as Record<IncrementalPathSegment, unknown>;
  }
  const key = path.at(-1)!;
  const current = parent[key];
  if (current && typeof current === 'object' && data && typeof data === 'object') {
    mergeObject(current as Record<string, unknown>, data as Record<string, unknown>);
  } else {
    parent[key] = clone(data);
  }
};

const insertItemsAtPath = (
  assembled: IncrementalSnapshot,
  path: readonly IncrementalPathSegment[],
  items: readonly unknown[],
) => {
  if (path.length === 0) {
    if (Array.isArray(assembled.data)) {
      assembled.data.push(...clone(items));
    }
    return;
  }
  const index = path.at(-1);
  if (typeof index !== 'number') {
    return;
  }
  let list = assembled.data;
  for (const segment of path.slice(0, -1)) {
    list = (list as Record<IncrementalPathSegment, unknown>)[segment];
  }
  if (Array.isArray(list)) {
    list.splice(index, 0, ...clone(items));
  }
};

const appendErrors = (assembled: IncrementalSnapshot, errors: readonly GraphQLFormattedError[] | undefined) => {
  if (errors?.length) {
    assembled.errors = [...(assembled.errors ?? []), ...clone(errors)];
  }
};

const mergeExtensions = (assembled: IncrementalSnapshot, extensions: Record<string, unknown> | undefined) => {
  if (extensions) {
    assembled.extensions = { ...assembled.extensions, ...clone(extensions) };
  }
};

type AssemblyState = {
  assembled: IncrementalSnapshot;
  pending: Map<string, readonly IncrementalPathSegment[]>;
  completed: Set<string>;
};

type PendingProtocolErrorCode = Exclude<IncrementalProtocolErrorCode, 'PREMATURE_EOF'>;

const protocolError = (
  code: PendingProtocolErrorCode,
  pendingId: string,
  partCount: number,
): IncrementalProtocolError => {
  const descriptions: Record<PendingProtocolErrorCode, string> = {
    UNKNOWN_PENDING_ID: `Incremental payload references unknown pending ID "${pendingId}".`,
    DUPLICATE_PENDING_ID: `Incremental payload declares live pending ID "${pendingId}" more than once.`,
    DUPLICATE_COMPLETION: `Incremental payload completes pending ID "${pendingId}" more than once.`,
    PATCH_AFTER_COMPLETION: `Incremental payload patches pending ID "${pendingId}" after completion.`,
  };
  return new IncrementalProtocolError(code, descriptions[code], {
    pendingId,
    partCount,
  });
};

const applyPayload = (state: AssemblyState, payload: InitialIncrementalPayload, partCount: number): AssemblyState => {
  const assembled = clone(state.assembled);
  const pending = new Map(state.pending);
  const completed = new Set(state.completed);

  if ('data' in payload) {
    assembled.data = clone(payload.data);
  }
  appendErrors(assembled, payload.errors);
  mergeExtensions(assembled, payload.extensions);

  for (const entry of payload.pending ?? []) {
    if (pending.has(entry.id) || completed.has(entry.id)) {
      throw protocolError('DUPLICATE_PENDING_ID', entry.id, partCount);
    }
    pending.set(entry.id, clone(entry.path ?? []));
  }

  for (const entry of payload.incremental ?? []) {
    let path: readonly IncrementalPathSegment[];
    if (entry.id === undefined) {
      path = entry.path ?? [];
    } else {
      if (completed.has(entry.id)) {
        throw protocolError('PATCH_AFTER_COMPLETION', entry.id, partCount);
      }
      const pendingPath = pending.get(entry.id);
      if (!pendingPath) {
        throw protocolError('UNKNOWN_PENDING_ID', entry.id, partCount);
      }
      path = [...pendingPath, ...(entry.subPath ?? [])];
    }
    if ('data' in entry) {
      mergeDataAtPath(assembled, path, entry.data);
    }
    if ('items' in entry) {
      insertItemsAtPath(assembled, path, entry.items ?? []);
    }
    appendErrors(assembled, entry.errors);
    mergeExtensions(assembled, entry.extensions);
  }

  for (const entry of payload.completed ?? []) {
    if (completed.has(entry.id)) {
      throw protocolError('DUPLICATE_COMPLETION', entry.id, partCount);
    }
    if (!pending.has(entry.id)) {
      throw protocolError('UNKNOWN_PENDING_ID', entry.id, partCount);
    }
    appendErrors(assembled, entry.errors);
    pending.delete(entry.id);
    completed.add(entry.id);
  }

  return { assembled, pending, completed };
};

const invoke = (callback: (() => void) | undefined) => {
  try {
    callback?.();
  } catch {
    // Observer failures must never replace a GraphQL result or protocol error.
  }
};

const monotonicNow = () => globalThis.performance?.now() ?? Date.now();

type Observation = ReturnType<typeof createObservation>;

const createObservation = (observer: IncrementalObserver) => {
  const startedAt = monotonicNow();
  let hasNext: boolean | undefined;
  let partCount = 0;
  let firstResultTimeMs: number | undefined;
  let totalDurationMs: number | undefined;
  let completionScheduled = false;
  let cancellationReported = false;

  const progress = (): IncrementalProgress => ({
    hasNext,
    partCount,
    ...(firstResultTimeMs === undefined ? {} : { firstResultTimeMs }),
    ...(totalDurationMs === undefined ? {} : { totalDurationMs }),
  });

  const reportError = (error: unknown) => invoke(() => observer.onError?.(error, progress()));

  invoke(() => observer.onStart?.(progress()));

  return {
    beginPart(next: boolean | undefined) {
      partCount++;
      hasNext = next ?? hasNext;
      return partCount;
    },
    recordSnapshot(snapshot: IncrementalSnapshot, terminal: boolean) {
      const elapsed = monotonicNow() - startedAt;
      const first = firstResultTimeMs === undefined;
      firstResultTimeMs ??= elapsed;
      if (terminal) {
        totalDurationMs = elapsed;
      }
      if (first) {
        invoke(() => observer.onFirstResult?.(snapshot, progress()));
      }
      invoke(() => observer.onSnapshot?.(snapshot, progress()));
    },
    scheduleCompletion(snapshot: IncrementalSnapshot) {
      if (completionScheduled) {
        return;
      }
      completionScheduled = true;
      const terminalProgress = progress();
      queueMicrotask(() => {
        let sideEffect: void | Promise<void>;
        try {
          sideEffect = observer.onComplete?.(snapshot, terminalProgress);
        } catch (error) {
          reportError(error);
          return;
        }
        Promise.resolve(sideEffect).catch(reportError);
      });
    },
    reportFailure(error: unknown, incomplete: boolean) {
      totalDurationMs ??= monotonicNow() - startedAt;
      if (incomplete && error instanceof IncrementalProtocolError) {
        invoke(() => observer.onIncomplete?.(error, progress()));
      }
      reportError(error);
    },
    reportCancellation() {
      if (cancellationReported) {
        return;
      }
      cancellationReported = true;
      totalDurationMs ??= monotonicNow() - startedAt;
      invoke(() => observer.onCancel?.(progress()));
    },
    get hasNext() {
      return hasNext;
    },
    get partCount() {
      return partCount;
    },
  };
};

const isPromiseLike = (value: unknown): value is PromiseLike<FetcherLikeValue> =>
  !!value && typeof value === 'object' && 'then' in value && typeof value.then === 'function';

const isAsyncIterable = (
  value: unknown,
): value is AsyncIterable<InitialIncrementalPayload | readonly InitialIncrementalPayload[]> =>
  !!value && typeof value === 'object' && Symbol.asyncIterator in value;

const isObservableLike = (value: unknown): value is ObservableLike<IncrementalSnapshot> =>
  !!value && typeof value === 'object' && 'subscribe' in value && typeof value.subscribe === 'function';

const prematureEOF = (partCount: number) =>
  new IncrementalProtocolError(
    'PREMATURE_EOF',
    'Incremental result ended before a payload explicitly set hasNext to false.',
    { partCount },
  );

const observeAsyncIterable = (
  result: AsyncIterable<InitialIncrementalPayload | readonly InitialIncrementalPayload[]>,
  observation: Observation,
): AsyncIterable<InitialIncrementalPayload | readonly InitialIncrementalPayload[]> =>
  (async function* () {
    let state: AssemblyState = {
      assembled: {},
      pending: new Map(),
      completed: new Set(),
    };
    let incremental = false;
    let exhausted = false;
    let failed = false;
    let terminal = false;
    let terminalSnapshot: IncrementalSnapshot | undefined;

    try {
      for await (const chunk of result) {
        if (!incremental) {
          const values = isIncrementalBatch(chunk) ? chunk : [chunk];
          incremental = values.some((value) => isIncrementalPayload(value));
          if (!incremental) {
            if (!isIncrementalBatch(chunk)) {
              observation.beginPart(undefined);
              observation.recordSnapshot(chunk, false);
            }
            yield chunk;
            continue;
          }
        }

        for (const payload of isIncrementalBatch(chunk) ? chunk : [chunk]) {
          const partCount = observation.beginPart(payload.hasNext);
          state = applyPayload(state, payload, partCount);
          terminal = payload.hasNext === false;
          observation.recordSnapshot(state.assembled, terminal);
          if (terminal) {
            terminalSnapshot = state.assembled;
            yield state.assembled;
            observation.scheduleCompletion(state.assembled);
            terminalSnapshot = undefined;
            return;
          }
          yield state.assembled;
        }
      }
      exhausted = true;
      if (incremental && observation.hasNext === true) {
        throw prematureEOF(observation.partCount);
      }
    } catch (error) {
      failed = true;
      if (error instanceof Error && error.name === 'AbortError') {
        observation.reportCancellation();
      } else {
        observation.reportFailure(error, error instanceof IncrementalProtocolError);
      }
      throw error;
    } finally {
      if (terminalSnapshot) {
        observation.scheduleCompletion(terminalSnapshot);
      }
      if (!exhausted && !failed && !terminal) {
        observation.reportCancellation();
      }
    }
  })();

const observePlainResult = (result: IncrementalSnapshot, observation: Observation): IncrementalSnapshot => {
  if (isIncrementalPayload(result)) {
    const partCount = observation.beginPart(result.hasNext);
    let state: AssemblyState;
    try {
      state = applyPayload({ assembled: {}, pending: new Map(), completed: new Set() }, result, partCount);
    } catch (error) {
      observation.reportFailure(error, error instanceof IncrementalProtocolError);
      throw error;
    }
    const terminal = result.hasNext === false;
    observation.recordSnapshot(state.assembled, terminal);
    if (!terminal) {
      const error = prematureEOF(partCount);
      observation.reportFailure(error, true);
      throw error;
    }
    observation.scheduleCompletion(state.assembled);
    return state.assembled;
  }

  observation.beginPart(false);
  observation.recordSnapshot(result, true);
  observation.scheduleCompletion(result);
  return result;
};

const observeResolvedResult = (result: FetcherLikeValue, observation: Observation): FetcherLikeValue => {
  if (isAsyncIterable(result)) {
    return observeAsyncIterable(result, observation);
  }
  if (isObservableLike(result) || isResultBatch(result)) {
    return result;
  }
  return observePlainResult(result, observation);
};

export const observeIncrementalResult = <T extends FetcherLikeResult>(result: T, observer: IncrementalObserver): T => {
  const observation = createObservation(observer);
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(
      (resolved) => observeResolvedResult(resolved, observation),
      (error) => {
        observation.reportFailure(error, false);
        throw error;
      },
    ) as unknown as T;
  }
  return observeResolvedResult(result, observation) as T;
};
