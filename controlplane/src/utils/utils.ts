import { CompositionOptions } from '../types/index.js';

export function newCompositionOptions(disableResolvabilityValidation?: boolean): CompositionOptions | undefined {
  if (!disableResolvabilityValidation) {
    return;
  }
  return {
    disableResolvabilityValidation,
  };
}
