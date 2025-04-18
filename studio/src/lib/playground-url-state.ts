import { PlaygroundStateSchema, PlaygroundUrlState } from '@/types/playground.types';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

const PLAYGROUND_STATE_QUERY_PARAM = 'playgroundUrlState';

/**
 * Compresses a playground state object into a URL-safe string
 * 
 * @param state - The playground state to compress
 * @returns A compressed, URL-safe string representation of the state
 * @throws Error if compression fails
 */
export function compressState(state: PlaygroundUrlState): string {
  const compressedState = compressToEncodedURIComponent(JSON.stringify(state));
    
  if (!compressedState) {
    throw new Error('Failed to compress playground state');
  }
  
  return compressedState;
}

/**
 * Creates a URL with the compressed playground state embedded
 * 
 * @param state - The playground state to embed
 * @param baseUrl - The base URL to use (defaults to current URL)
 * @returns A URL with the playground state as a query parameter
 */
export function createStateUrl(state: PlaygroundUrlState, baseUrl?: string): string {
  const compressedState = compressState(state);
  const url = new URL(baseUrl || window.location.href);
  url.searchParams.set(PLAYGROUND_STATE_QUERY_PARAM, compressedState);
  return url.toString();
}

