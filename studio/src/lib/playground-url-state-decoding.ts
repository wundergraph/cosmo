/**
 * This lib focuses on deserialization logic for sharing state
 */
import { PlaygroundStateSchema, PlaygroundUrlState } from '../components/playground/types';
import { decompressFromEncodedURIComponent } from 'lz-string';
import { PLAYGROUND_STATE_QUERY_PARAM } from './constants';

/**
 * Decompresses a URL-safe string into a playground state object
 * 
 * @param compressedState - The compressed state string to decompress
 * @returns The decompressed and validated playground state
 * @throws Error if decompression fails or validation fails
 */
export const decompressState = (compressedState: string): PlaygroundUrlState => {
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
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[Playground] decompressed state:', result.data);
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