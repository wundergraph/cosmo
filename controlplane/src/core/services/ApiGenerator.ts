import { uid } from 'uid/secure';
import { traced } from '../tracing.js';

@traced
export class ApiKeyGenerator {
  public static generate(): string {
    return `cosmo_${uid(32)}`;
  }
}
