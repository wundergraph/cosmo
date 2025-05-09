/**
 * This lib focuses on serialization logic for sharing state
 */
import { compressToEncodedURIComponent } from 'lz-string';
import { PlaygroundUrlState, ShareOptionId, TabState } from '../components/playground/types';
import { hideScriptsSharing, PLAYGROUND_STATE_QUERY_PARAM } from './constants';
import { getPreFlightScript, getScriptTabState } from './playground-storage';

/**
 * Helper which generates the state to share based on the selected options
 */
export const buildStateToShare = (
  selectedOptions: Record<ShareOptionId, boolean>, 
  currentTab: TabState
): PlaygroundUrlState => {
  const { query, variables, headers, id } = currentTab;

  const stateToShare: PlaygroundUrlState = {
    // Always include operation
    operation: query ?? "",
  };

  if (selectedOptions.variables && variables) {
    stateToShare.variables = variables;
  }

  if (selectedOptions.headers && headers !== null) {
    stateToShare.headers = headers;
  }

  // todo: [ENG-7093] when adding the pre-flight, pre-operation and post-operation options,
  // remove this !hideScriptsSharing check.
  // Instead of using playground-storage, make sure we instead rely on useLocalStorage here
  if (!hideScriptsSharing) {
    if (selectedOptions.preFlight) {
      const preFlight = getPreFlightScript();
      if (preFlight) stateToShare.preFlight = preFlight;
    }
  
    if (selectedOptions.preOperation && id) {
      stateToShare.preOperation = getScriptTabState(id, 'pre-operation');
    }
  
    if (selectedOptions.postOperation && id) {
      stateToShare.postOperation = getScriptTabState(id, 'post-operation');
    }
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[Playground] compressed state:', stateToShare);
  }

  return stateToShare;
};

/**
 * Creates a URL with the compressed playground state embedded
 * 
 * @param state - The playground state to embed
 * @param baseUrl - The base URL to use (defaults to current URL)
 * @returns A URL with the playground state as a query parameter
 */
export const createCompressedStateUrl = (state: PlaygroundUrlState, baseUrl?: string): string => {
  const compressState = (state: PlaygroundUrlState): string => {
    const compressedState = compressToEncodedURIComponent(JSON.stringify(state));
      
    if (!compressedState) {
      throw new Error('Failed to compress playground state');
    }
    
    return compressedState;
  }

  const compressedState = compressState(state);
  const url = new URL(baseUrl || window.location.href);
  url.searchParams.set(PLAYGROUND_STATE_QUERY_PARAM, compressedState);
  return url.toString();
}
