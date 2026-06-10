import { runCacheExplorer, CacheExplorerConfig } from './cache-explorer-runner';
import { CacheExplorerState } from './cache-explorer-types';

// Module-level singleton that bridges the graphiQLFetch intercept (which wants
// to start a run when the user clicks play) and the CacheExplorerView
// component (which needs to subscribe to state changes and show a Cancel
// button). Keeping this outside React context avoids prop-drilling and lets
// the fetcher dispatch without knowing about the React tree.

type Listener = (state: CacheExplorerState) => void;

let currentState: CacheExplorerState = { status: 'idle' };
const listeners = new Set<Listener>();
let currentController: AbortController | null = null;
let currentRunId = 0;

const emit = (next: CacheExplorerState) => {
  currentState = next;
  for (const fn of listeners) fn(currentState);
};

export const cacheExplorerController = {
  getState: (): CacheExplorerState => currentState,

  subscribe: (fn: Listener): (() => void) => {
    listeners.add(fn);
    fn(currentState);
    return () => {
      listeners.delete(fn);
    };
  },

  start: async (config: CacheExplorerConfig): Promise<void> => {
    if (currentController) {
      currentController.abort();
    }
    const controller = new AbortController();
    currentController = controller;
    const runId = ++currentRunId;
    const emitIfCurrent = (next: CacheExplorerState) => {
      if (runId === currentRunId) emit(next);
    };
    try {
      await runCacheExplorer(config, emitIfCurrent, controller.signal);
    } catch (err: any) {
      if (runId !== currentRunId) {
        // A newer run has taken over — do not clobber its state.
        return;
      }
      if (err?.message === 'aborted' || err?.name === 'AbortError') {
        emit({ status: 'idle' });
      } else {
        emit({ status: 'error', message: err?.message || 'Cache explorer failed' });
      }
    } finally {
      if (currentController === controller) {
        currentController = null;
      }
    }
  },

  abort: (): void => {
    if (currentController) {
      currentController.abort();
      currentController = null;
    }
  },

  reset: (): void => {
    emit({ status: 'idle' });
  },
};
