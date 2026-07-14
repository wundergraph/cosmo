import {
  createGraphiQLFetcher,
  type CreateFetcherOptions,
  type Fetcher,
  type FetcherParams,
  type FetcherReturnType,
} from '@graphiql/toolkit';
import {
  IncrementalProtocolError,
  observeIncrementalResult,
  type IncrementalSnapshot,
} from '@wundergraph/cosmo-shared/playground/incremental-delivery';
import { getOperationAST, parse, type GraphQLSchema } from 'graphql';
import posthog from 'posthog-js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { PlaygroundExecutionState } from './types';
import { isInitialPlaygroundTabAdoption } from './playground-request-key';
import {
  createStudioPlaygroundFetch,
  executePostScripts,
  type PlaygroundTarget,
  type StudioPlaygroundFetchResult,
} from './playground-fetcher';

type FetcherFactory = (options: CreateFetcherOptions) => Fetcher;

type GenerationGuard = {
  invalidate(): void;
  isCurrent(generation: number): boolean;
  next(): number;
  onInvalidate(generation: number, cancel: () => void | Promise<void>): () => void;
};

type PlaygroundExecutionOptions = {
  capture?(event: string, properties: { query_success: boolean }): void;
  clientValidationEnabled: boolean;
  createFetcher?: FetcherFactory;
  executePostOperation?(graphId: string, requestBody: FetcherParams, responseBody: IncrementalSnapshot): Promise<void>;
  featureFlagName?: string;
  fetchImpl?: typeof fetch;
  generationGuard?: GenerationGuard;
  graphId: string;
  graphRequestToken: string;
  onExecutionState?(state: PlaygroundExecutionState): void;
  onStatus?(status?: number, statusText?: string): void;
  routingUrl: string;
  schema?: GraphQLSchema | null;
  subscriptionUrl?: string;
  target: PlaygroundTarget;
};

type UsePlaygroundExecutionOptions = Omit<
  PlaygroundExecutionOptions,
  'capture' | 'createFetcher' | 'executePostOperation' | 'generationGuard' | 'onExecutionState' | 'onStatus'
> & {
  activeRequestKey: string;
};

const createGenerationGuard = (): GenerationGuard => {
  let current = 0;
  let cancellations = new Set<() => void | Promise<void>>();

  const advance = () => {
    const invalidated = cancellations;
    cancellations = new Set();
    current++;
    invalidated.forEach((cancel) => {
      try {
        void Promise.resolve(cancel()).catch(() => undefined);
      } catch {
        // Cancellation is best effort and must not block the newer execution.
      }
    });
  };

  return {
    invalidate: advance,
    isCurrent: (generation) => generation === current,
    next: () => {
      advance();
      return current;
    },
    onInvalidate: (generation, cancel) => {
      if (generation !== current) {
        try {
          void Promise.resolve(cancel()).catch(() => undefined);
        } catch {
          // The generation was already stale, so cancellation remains best effort.
        }
        return () => undefined;
      }
      cancellations.add(cancel);
      return () => cancellations.delete(cancel);
    },
  };
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  !!value && typeof value === 'object' && Symbol.asyncIterator in value;

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof value === 'object' && 'then' in value && typeof value.then === 'function';

const isIncrementalPayload = (value: unknown) =>
  !!value &&
  typeof value === 'object' &&
  ('hasNext' in value || 'pending' in value || 'incremental' in value || 'completed' in value);

// createGraphiQLFetcher represents a one-shot JSON HTTP result as a one-value
// async iterable when multipart support is enabled. Mark that HTTP value as
// terminal so the shared observer can distinguish it from a subscription.
const markPlainHTTPResultTerminal = (result: unknown): unknown => {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(markPlainHTTPResultTerminal);
  }
  if (!isAsyncIterable(result)) {
    return result;
  }

  return (async function* () {
    for await (const value of result) {
      if (Array.isArray(value) ? value.some(isIncrementalPayload) : isIncrementalPayload(value)) {
        yield value;
        continue;
      }
      if (Array.isArray(value)) {
        yield value;
        continue;
      }
      if (!value || typeof value !== 'object') {
        yield value;
        return;
      }
      yield { ...(value as Record<string, unknown>), hasNext: false };
      return;
    }
  })();
};

const suppressSupersededResults = (
  result: unknown,
  generation: number,
  guard: GenerationGuard,
  cancel: () => void,
  onCancel: () => void,
  onSettled: () => void,
): unknown => {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(
      (resolved) => suppressSupersededResults(resolved, generation, guard, cancel, onCancel, onSettled),
      (error) => {
        onSettled();
        throw error;
      },
    );
  }
  if (!isAsyncIterable(result)) {
    onSettled();
    return result;
  }

  const iterator = result[Symbol.asyncIterator]();
  let closed = false;
  let settled = false;
  let unregisterIterator: () => void = () => undefined;
  const settle = () => {
    if (settled) {
      return;
    }
    settled = true;
    unregisterIterator();
    onSettled();
  };
  const closeUnderlying = (value?: unknown) => {
    try {
      const pendingReturn = iterator.return?.(value);
      if (pendingReturn) {
        void Promise.resolve(pendingReturn).catch(() => undefined);
      }
    } catch {
      // The request abort is authoritative; iterator cleanup remains best effort.
    }
  };
  const cancelAndClose = (value?: unknown) => {
    if (closed) {
      return false;
    }
    closed = true;
    cancel();
    closeUnderlying(value);
    settle();
    return true;
  };
  unregisterIterator = guard.onInvalidate(generation, () => {
    cancelAndClose();
  });

  const wrapped: AsyncIterableIterator<unknown> = {
    async next() {
      if (closed || !guard.isCurrent(generation)) {
        cancelAndClose();
        return { done: true, value: undefined };
      }
      try {
        const next = await iterator.next();
        if (closed || !guard.isCurrent(generation)) {
          cancelAndClose();
          return { done: true, value: undefined };
        }
        if (next.done) {
          closed = true;
          settle();
        }
        return next;
      } catch (error) {
        const cancelled = closed || !guard.isCurrent(generation) || abortControllerError(error);
        closed = true;
        settle();
        if (cancelled) {
          return { done: true, value: undefined };
        }
        throw error;
      }
    },
    async return(value?: unknown) {
      if (cancelAndClose(value)) {
        onCancel();
      }
      return { done: true, value };
    },
    async throw(error?: unknown) {
      cancelAndClose();
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return wrapped;
};

const abortControllerError = (error: unknown) =>
  !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';

const operationKind = (params: FetcherParams, documentAST?: Parameters<typeof getOperationAST>[0]) => {
  try {
    return getOperationAST(documentAST ?? parse(params.query), params.operationName ?? undefined)?.operation;
  } catch {
    return;
  }
};

const isIntrospection = (params: FetcherParams) => params.operationName === 'IntrospectionQuery';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export const createPlaygroundExecutionFetcher = (options: PlaygroundExecutionOptions): Fetcher => {
  const generationGuard = options.generationGuard ?? createGenerationGuard();
  const createFetcher = options.createFetcher ?? createGraphiQLFetcher;
  const capture = options.capture ?? ((event, properties) => posthog.capture(event, properties));
  const executePostOperation = options.executePostOperation ?? executePostScripts;

  return (params, fetcherOptions) => {
    const introspection = isIntrospection(params);
    const generation = introspection ? 0 : generationGuard.next();
    const abortController = introspection ? undefined : new AbortController();
    const unregisterAbort = abortController
      ? generationGuard.onInvalidate(generation, () => abortController.abort())
      : () => undefined;
    let transportResult: StudioPlaygroundFetchResult | undefined;
    let latestProgress: PlaygroundExecutionState['progress'];

    if (!introspection) {
      options.onStatus?.();
      options.onExecutionState?.({ phase: 'streaming' });
    }

    const reportTransportResult = (result: StudioPlaygroundFetchResult) => {
      transportResult = result;
      if (introspection || !generationGuard.isCurrent(generation)) {
        return;
      }
      if (result.kind === 'response') {
        options.onStatus?.(result.status, result.statusText);
      } else if (result.kind === 'network-error') {
        options.onStatus?.(undefined, 'Network Error');
        options.onExecutionState?.({ phase: 'error', message: 'The network request failed.' });
      }
    };

    const rawFetch = createStudioPlaygroundFetch({
      clientValidationEnabled: options.clientValidationEnabled,
      featureFlagName: options.featureFlagName,
      fetchImpl: options.fetchImpl,
      graphId: options.graphId,
      graphRequestToken: options.graphRequestToken,
      onResult: reportTransportResult,
      schema: options.schema,
      signal: abortController?.signal,
      target: options.target,
    });
    const baseFetcher = createFetcher({
      url: options.routingUrl,
      subscriptionUrl: options.subscriptionUrl,
      fetch: rawFetch,
    });
    let result: FetcherReturnType;
    try {
      result = baseFetcher(params, fetcherOptions);
    } catch (error) {
      unregisterAbort();
      if (!introspection && generationGuard.isCurrent(generation)) {
        options.onExecutionState?.({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }

    if (introspection) {
      return result;
    }

    const isSubscription = operationKind(params, fetcherOptions?.documentAST) === 'subscription';
    const observableResult = isSubscription ? result : markPlainHTTPResultTerminal(result);

    const observed = observeIncrementalResult(observableResult as FetcherReturnType, {
      onSnapshot: (_snapshot, progress) => {
        latestProgress = progress;
        if (generationGuard.isCurrent(generation) && transportResult?.kind !== 'network-error') {
          options.onExecutionState?.({ phase: 'streaming', progress });
        }
      },
      onComplete: async (snapshot, progress) => {
        if (!generationGuard.isCurrent(generation)) {
          return;
        }

        // Validation and synthetic network-error responses were never executed
        // by a target, matching the pre-stream Studio behavior.
        if (transportResult?.kind === 'network-error') {
          return;
        }
        options.onExecutionState?.({ phase: 'complete', progress });
        if (transportResult?.kind === 'validation') {
          return;
        }

        await executePostOperation(options.graphId, params, snapshot);
        if (!generationGuard.isCurrent(generation)) {
          return;
        }
        const hasErrors = (snapshot.errors?.length ?? 0) > 0;
        const responseOK = transportResult?.kind !== 'response' || transportResult.ok;
        capture('cosmo_studio_query_executed', {
          query_success: responseOK && !hasErrors,
        });
      },
      onIncomplete: (error, progress) => {
        if (generationGuard.isCurrent(generation)) {
          options.onExecutionState?.({ phase: 'incomplete', progress, message: error.message });
        }
      },
      onCancel: (progress) => {
        if (generationGuard.isCurrent(generation)) {
          options.onExecutionState?.({ phase: 'cancelled', progress });
        }
      },
      onError: (error, progress) => {
        if (!generationGuard.isCurrent(generation)) {
          return;
        }
        if (abortController?.signal.aborted && abortControllerError(error)) {
          options.onExecutionState?.({ phase: 'cancelled', progress });
        } else if (!(error instanceof IncrementalProtocolError)) {
          options.onExecutionState?.({
            phase: 'error',
            progress,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    });
    return suppressSupersededResults(
      observed,
      generation,
      generationGuard,
      () => abortController?.abort(),
      () => {
        if (generationGuard.isCurrent(generation)) {
          options.onExecutionState?.({ phase: 'cancelled', progress: latestProgress });
        }
      },
      unregisterAbort,
    ) as FetcherReturnType;
  };
};

export const usePlaygroundExecution = (options: UsePlaygroundExecutionOptions) => {
  const guardsByRequest = useRef(new Map<string, GenerationGuard>());
  const activeRequestKey = useRef(options.activeRequestKey);
  let guard = guardsByRequest.current.get(options.activeRequestKey);
  if (!guard) {
    guard = isInitialPlaygroundTabAdoption(activeRequestKey.current, options.activeRequestKey)
      ? guardsByRequest.current.get(activeRequestKey.current)
      : undefined;
    guard ??= createGenerationGuard();
    guardsByRequest.current.set(options.activeRequestKey, guard);
  }
  const [status, setStatus] = useState<number>();
  const [statusText, setStatusText] = useState<string>();
  const executionByRequest = useRef(new Map<string, PlaygroundExecutionState>());
  const requestKeyAliases = useRef(new Map<string, string>());
  const [, renderExecutionState] = useState(0);

  useIsomorphicLayoutEffect(() => {
    if (activeRequestKey.current === options.activeRequestKey) {
      return;
    }
    const previousKey = activeRequestKey.current;
    if (isInitialPlaygroundTabAdoption(previousKey, options.activeRequestKey)) {
      const previousGuard = guardsByRequest.current.get(previousKey);
      if (previousGuard) {
        guardsByRequest.current.set(options.activeRequestKey, previousGuard);
      }
      guardsByRequest.current.delete(previousKey);
      const previousExecution = executionByRequest.current.get(previousKey);
      if (previousExecution) {
        executionByRequest.current.set(options.activeRequestKey, previousExecution);
        executionByRequest.current.delete(previousKey);
      }
      requestKeyAliases.current.set(previousKey, options.activeRequestKey);
      activeRequestKey.current = options.activeRequestKey;
      renderExecutionState((revision) => revision + 1);
      return;
    }
    const previousExecution = executionByRequest.current.get(previousKey);
    if (previousExecution?.phase === 'streaming') {
      executionByRequest.current.set(previousKey, {
        phase: 'cancelled',
        progress: previousExecution.progress,
      });
    }
    activeRequestKey.current = options.activeRequestKey;
    guardsByRequest.current.get(previousKey)?.invalidate();
    guardsByRequest.current.delete(previousKey);
    setStatus(undefined);
    setStatusText(undefined);
    renderExecutionState((revision) => revision + 1);
  }, [options.activeRequestKey]);

  const fetcher = useMemo(
    () =>
      createPlaygroundExecutionFetcher({
        capture: (event, properties) => posthog.capture(event, properties),
        clientValidationEnabled: options.clientValidationEnabled,
        executePostOperation: executePostScripts,
        featureFlagName: options.featureFlagName,
        fetchImpl: options.fetchImpl,
        generationGuard: guard,
        graphId: options.graphId,
        graphRequestToken: options.graphRequestToken,
        onExecutionState: (state) => {
          const requestKey = requestKeyAliases.current.get(options.activeRequestKey) ?? options.activeRequestKey;
          executionByRequest.current.set(requestKey, state);
          renderExecutionState((revision) => revision + 1);
        },
        onStatus: (nextStatus, nextStatusText) => {
          setStatus(nextStatus);
          setStatusText(nextStatusText);
        },
        routingUrl: options.routingUrl,
        schema: options.schema,
        subscriptionUrl: options.subscriptionUrl,
        target: options.target,
      }),
    [
      guard,
      options.clientValidationEnabled,
      options.activeRequestKey,
      options.featureFlagName,
      options.fetchImpl,
      options.graphId,
      options.graphRequestToken,
      options.routingUrl,
      options.schema,
      options.subscriptionUrl,
      options.target,
    ],
  );

  useIsomorphicLayoutEffect(
    () => () => {
      guardsByRequest.current.forEach((requestGuard) => requestGuard.invalidate());
    },
    [],
  );

  return {
    execution: executionByRequest.current.get(options.activeRequestKey) ?? { phase: 'idle' },
    fetcher,
    status,
    statusText,
  };
};
