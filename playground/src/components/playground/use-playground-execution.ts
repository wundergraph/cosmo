import { createGraphiQLFetcher, type Fetcher } from '@graphiql/toolkit';
import {
  observeIncrementalResult,
  type IncrementalProgress,
  type IncrementalSnapshot,
} from '@wundergraph/cosmo-shared/playground/incremental-delivery';
import { getOperationAST, parse, type GraphQLSchema } from 'graphql';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { TabsState } from './types';
import { createPlaygroundHTTPFetch, executePostScripts, type GraphiQLScripts } from './playground-fetcher';

export type { GraphiQLScripts } from './playground-fetcher';

export type RequestTimingState = 'streaming' | 'complete' | 'incomplete' | 'cancelled' | 'error';

export type RequestTiming = {
  ttfbMs?: number;
  totalMs?: number;
  inFlight: boolean;
  state: RequestTimingState;
  partCount: number;
  message?: string;
};

export const getActiveTabExecution = (tabsState: TabsState, fallback: { query?: string; headers: string }) => {
  const activeTab = tabsState.tabs[tabsState.activeTabIndex];
  return {
    id: activeTab?.id,
    query: activeTab?.query ?? fallback.query,
    headers: activeTab?.headers ?? fallback.headers,
    variables: activeTab?.variables ?? undefined,
    operationName: activeTab?.operationName ?? undefined,
    response: activeTab?.response ?? '',
  };
};

type PlaygroundExecutionScope = {
  isCurrent: () => boolean;
  isOriginCurrent?: () => boolean;
  isVisible: () => boolean;
  tabId?: () => string;
};

type PlaygroundExecutionCallbacks = {
  beginExecution?: (
    request: Parameters<Fetcher>[0],
    options: Parameters<Fetcher>[1],
  ) => (() => boolean) | PlaygroundExecutionScope;
  onResponse?: (response: IncrementalSnapshot) => void;
  onTiming?: (timing: RequestTiming, scope?: PlaygroundExecutionScope) => void;
  executePostOperation?: (request: Parameters<Fetcher>[0], response: IncrementalSnapshot) => void | Promise<void>;
  onPostOperationError?: (error: unknown) => void;
};

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
  !!value && typeof value === 'object' && 'then' in value && typeof value.then === 'function';

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  !!value && typeof value === 'object' && Symbol.asyncIterator in value;

const emptyResult = (): AsyncIterable<never> =>
  (async function* () {
    return;
  })();

// GraphiQL writes every yielded value into whichever tab is active at that
// moment. Suppress values from superseded/hidden executions before they reach
// GraphiQL, not only in our observer callbacks.
const filterInactiveResult = (result: unknown, isActive: () => boolean): unknown => {
  if (isPromiseLike(result)) {
    return Promise.resolve(result).then(
      (resolved) => filterInactiveResult(resolved, isActive),
      (error) => {
        if (!isActive()) {
          return emptyResult();
        }
        throw error;
      },
    );
  }
  if (isAsyncIterable(result)) {
    return (async function* () {
      try {
        for await (const value of result) {
          if (!isActive()) {
            return;
          }
          yield value;
        }
      } catch (error) {
        if (isActive()) {
          throw error;
        }
      }
    })();
  }
  return isActive() ? result : emptyResult();
};

const timingFromProgress = (
  progress: IncrementalProgress,
  state: RequestTimingState,
  message?: string,
): RequestTiming => ({
  ttfbMs: progress.firstResultTimeMs,
  totalMs:
    progress.totalDurationMs ??
    (state === 'complete' && progress.hasNext === undefined ? progress.firstResultTimeMs : undefined),
  inFlight: state === 'streaming',
  state,
  partCount: progress.partCount,
  ...(message ? { message } : {}),
});

const isSubscription = (request: Parameters<Fetcher>[0], options: Parameters<Fetcher>[1]) => {
  try {
    const document = options?.documentAST ?? parse(request.query);
    return getOperationAST(document, request.operationName ?? undefined)?.operation === 'subscription';
  } catch {
    return false;
  }
};

const shouldExecutePostOperation = (response: IncrementalSnapshot) =>
  !!response &&
  typeof response === 'object' &&
  !Array.isArray(response) &&
  !Object.prototype.hasOwnProperty.call(response, 'message') &&
  (Object.prototype.hasOwnProperty.call(response, 'data') || Object.prototype.hasOwnProperty.call(response, 'errors'));

// GraphiQL owns HTTP and multipart parsing. This wrapper observes the fetcher's
// parsed result so the response pane and ART consume the same assembled
// snapshots, while terminal side effects remain tied to protocol completion.
export const createObservedPlaygroundFetcher = (
  baseFetcher: Fetcher,
  callbacks: PlaygroundExecutionCallbacks,
): Fetcher => {
  let latestExecution = 0;

  return (request, options) => {
    // Introspection is an internal GraphiQL request and must not affect a user
    // execution. Subscriptions still supersede the previous operation, but do
    // not have an operation-level terminal payload to observe.
    if (request.operationName === 'IntrospectionQuery') {
      return baseFetcher(request, options);
    }

    const execution = ++latestExecution;
    const externalGuard = callbacks.beginExecution?.(request, options);
    const hasSplitGuard = typeof externalGuard === 'object';
    const isCurrent = () =>
      hasSplitGuard
        ? externalGuard.isCurrent()
        : execution === latestExecution && (typeof externalGuard === 'function' ? externalGuard() : true);
    const isVisible = () => (hasSplitGuard ? externalGuard.isVisible() : true);
    const shouldDeliver = () => isCurrent() && isVisible();
    const result = baseFetcher(request, options);
    if (isSubscription(request, options)) {
      return filterInactiveResult(result, shouldDeliver) as ReturnType<Fetcher>;
    }
    let terminalState: Exclude<RequestTimingState, 'streaming'> | undefined;
    let postOperationStarted = false;

    const reportPostOperationError = (error: unknown) => {
      try {
        callbacks.onPostOperationError?.(error);
      } catch {
        // User script failures must not replace or reject a GraphQL result.
      }
    };

    const reportTiming = (progress: IncrementalProgress, state: RequestTimingState, message?: string) => {
      if (isCurrent()) {
        callbacks.onTiming?.(timingFromProgress(progress, state, message), hasSplitGuard ? externalGuard : undefined);
      }
    };

    const cancelOnce = (progress: IncrementalProgress) => {
      if (terminalState) {
        return;
      }
      terminalState = 'cancelled';
      if (!hasSplitGuard || externalGuard.isOriginCurrent?.() !== false) {
        callbacks.onTiming?.(timingFromProgress(progress, 'cancelled'), hasSplitGuard ? externalGuard : undefined);
      }
    };

    const completeOnce = (response: IncrementalSnapshot, progress: IncrementalProgress) => {
      if (postOperationStarted || terminalState) {
        return;
      }
      if (!shouldDeliver()) {
        cancelOnce(progress);
        return;
      }
      postOperationStarted = true;
      terminalState = 'complete';
      reportTiming(progress, 'complete');
      if (shouldExecutePostOperation(response)) {
        try {
          const sideEffect = callbacks.executePostOperation?.(request, response);
          if (isPromiseLike(sideEffect)) {
            Promise.resolve(sideEffect).catch(reportPostOperationError);
          }
        } catch (error) {
          reportPostOperationError(error);
        }
      }
    };

    const observed = observeIncrementalResult(result as any, {
      onStart: (progress) => reportTiming(progress, 'streaming'),
      onSnapshot: (response, progress) => {
        if (!shouldDeliver()) {
          cancelOnce(progress);
          return;
        }
        callbacks.onResponse?.(response);
        if (progress.hasNext === false) {
          void completeOnce(response, progress);
        } else if (progress.hasNext === undefined) {
          // createGraphiQLFetcher represents an ordinary JSON HTTP response as
          // a one-value async iterable. For a non-subscription operation that
          // first parsed snapshot is also the terminal result.
          void completeOnce(response, progress);
        } else {
          reportTiming(progress, 'streaming');
        }
      },
      onComplete: (response, progress) => completeOnce(response, progress),
      onIncomplete: (error, progress) => {
        if (!isCurrent()) {
          cancelOnce(progress);
          return;
        }
        terminalState = 'incomplete';
        reportTiming(progress, 'incomplete', error.message);
      },
      onCancel: (progress) => {
        cancelOnce(progress);
      },
      onError: (error, progress) => {
        if (terminalState) {
          return;
        }
        if (!isCurrent()) {
          cancelOnce(progress);
          return;
        }
        terminalState = 'error';
        reportTiming(progress, 'error', error instanceof Error ? error.message : String(error));
      },
    });

    return filterInactiveResult(observed, shouldDeliver) as ReturnType<Fetcher>;
  };
};

type UsePlaygroundExecutionOptions = {
  url: string;
  schema: GraphQLSchema | null;
  clientValidationEnabled: boolean;
  activeTabId?: string;
  scripts?: GraphiQLScripts;
  fetch?: typeof fetch;
};

const unboundTabId = '__unbound_playground_tab__';

export const bindInitialTabState = <T>(state: Record<string, T>, tabId: string): Record<string, T> => {
  if (tabId === unboundTabId || !Object.prototype.hasOwnProperty.call(state, unboundTabId)) {
    return state;
  }
  const next = { ...state, [tabId]: state[unboundTabId] };
  delete next[unboundTabId];
  return next;
};

type ExecutionScope = PlaygroundExecutionScope & { isOriginCurrent: () => boolean; tabId: () => string };

export const createTabExecutionTracker = (getActiveTabId: () => string | undefined) => {
  let currentToken: object | undefined;
  const currentByOrigin = new Map<string, object>();
  const activeTab = () => getActiveTabId() ?? unboundTabId;

  return {
    begin(): ExecutionScope {
      let originTab = activeTab();
      const token = {};
      currentToken = token;
      currentByOrigin.set(originTab, token);

      const tabId = () => {
        const active = activeTab();
        if (originTab === unboundTabId && active !== unboundTabId) {
          if (currentByOrigin.get(originTab) === token) {
            currentByOrigin.delete(originTab);
            currentByOrigin.set(active, token);
          }
          originTab = active;
        }
        return originTab;
      };

      return {
        tabId,
        isCurrent: () => currentToken === token,
        isOriginCurrent: () => currentByOrigin.get(tabId()) === token,
        isVisible: () => tabId() === activeTab(),
      };
    },
  };
};

export const usePlaygroundExecution = ({
  url,
  schema,
  clientValidationEnabled,
  activeTabId,
  scripts,
  fetch: customFetch,
}: UsePlaygroundExecutionOptions) => {
  const [statusByTab, setStatusByTab] = useState<Record<string, { status?: number; statusText?: string }>>({});
  const [timingByTab, setTimingByTab] = useState<Record<string, RequestTiming>>({});
  const activeTabIdRef = useRef(activeTabId ?? unboundTabId);
  const executionTracker = useRef<ReturnType<typeof createTabExecutionTracker>>();
  executionTracker.current ??= createTabExecutionTracker(() => activeTabIdRef.current);
  const currentExecutionScope = useRef<ExecutionScope>();

  if (activeTabId) {
    activeTabIdRef.current = activeTabId;
  }

  const activateTab = useCallback((tabId: string | undefined) => {
    const nextTabId = tabId ?? unboundTabId;
    if (activeTabIdRef.current === unboundTabId && nextTabId !== unboundTabId) {
      setStatusByTab((current) => bindInitialTabState(current, nextTabId));
      setTimingByTab((current) => bindInitialTabState(current, nextTabId));
    }
    activeTabIdRef.current = nextTabId;
  }, []);

  const fetcher = useMemo(() => {
    const baseFetcher: Fetcher = (request, options) => {
      // beginExecution runs immediately before this function for user
      // operations. Introspection intentionally gets a separate tab-scoped
      // status guard without participating in execution timing/scripts.
      const scope =
        request.operationName === 'IntrospectionQuery' || !currentExecutionScope.current
          ? (() => {
              const tabId = activeTabIdRef.current;
              return {
                tabId: () => tabId,
                isCurrent: () => true,
                isVisible: () => tabId === activeTabIdRef.current,
              };
            })()
          : currentExecutionScope.current;
      const httpFetch = createPlaygroundHTTPFetch({
        fetchImplementation: customFetch ?? globalThis.fetch.bind(globalThis),
        schema,
        clientValidationEnabled,
        scripts,
        onResponseStatus: (nextStatus, nextStatusText) => {
          if (!scope.isCurrent()) {
            return;
          }
          const tabId = scope.tabId();
          setStatusByTab((current) => ({
            ...current,
            [tabId]: { status: nextStatus, statusText: nextStatusText },
          }));
        },
      });
      return createGraphiQLFetcher({
        url,
        subscriptionUrl: url.replace('http', 'ws'),
        fetch: httpFetch,
      })(request, options);
    };
    return createObservedPlaygroundFetcher(baseFetcher, {
      beginExecution: () => {
        const scope = executionTracker.current!.begin();
        currentExecutionScope.current = scope;
        return scope;
      },
      onTiming: (nextTiming, scope) => {
        const tabId = scope?.tabId?.() ?? activeTabIdRef.current;
        setTimingByTab((current) => ({ ...current, [tabId]: nextTiming }));
      },
      executePostOperation: (request, nextResponse) => executePostScripts('0', request, nextResponse),
      onPostOperationError: (error) => console.error('Failed to execute the post-operation script.', error),
    });
  }, [clientValidationEnabled, customFetch, schema, scripts, url]);

  const status = statusByTab[activeTabId ?? unboundTabId];

  return {
    activateTab,
    fetcher,
    requestTiming: timingByTab[activeTabId ?? unboundTabId],
    status: status?.status,
    statusText: status?.statusText,
  };
};
