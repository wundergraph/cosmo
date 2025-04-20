/**
 * This lib focuses on serialization/deserialization logic for sharing state
 */
import { ShareOptionId, TabState } from '@/components/playground/types';
import { PlaygroundStateSchema, PlaygroundUrlState } from '@/types/playground.types';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { getPreFlightScript, getScriptTabState } from './playground-storage';

const PLAYGROUND_STATE_QUERY_PARAM = 'playgroundUrlState';

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

/**
 * Decompresses a URL-safe string into a playground state object
 * 
 * @param compressedState - The compressed state string to decompress
 * @returns The decompressed and validated playground state
 * @throws Error if decompression fails or validation fails
 */
const decompressState = (compressedState: string): PlaygroundUrlState => {
  const decompressed = decompressFromEncodedURIComponent(compressedState);
  
  if (!decompressed) {
    throw new Error('Failed to decompress playground state');
  }
  
  const parsedState = JSON.parse(decompressed);
  // Validate using Zod schema
  const result = PlaygroundStateSchema.safeParse(parsedState);
  
  if (!result.success) {
    throw new Error(`Invalid playground state: ${result.error.errors.map((e) => e.toString()).join('\n')}`);
  }
  
  return result.data;
}

/**
 * Helper function to get the playground state parameter from the current URL
 */
export const extractStateFromUrl = (): PlaygroundUrlState | null => {
  const params = new URLSearchParams(window.location.search);
  const stateParam = params.get(PLAYGROUND_STATE_QUERY_PARAM);
  
  if (!stateParam) {
      return null;
  }
    
  return decompressState(stateParam);
}