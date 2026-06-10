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

const emit = (next: CacheExplorerState) => {
  currentState = next;
  listeners.forEach((fn) => fn(currentState));
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
    currentController = new AbortController();
    try {
      await runCacheExplorer(config, emit, currentController.signal);
    } catch (err: any) {
      if (err?.message === 'aborted' || err?.name === 'AbortError') {
        emit({ status: 'idle' });
      } else {
        emit({ status: 'error', message: err?.message || 'Cache explorer failed' });
      }
    } finally {
      currentController = null;
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
