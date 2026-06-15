/**
 * Ambient module declaration for `redlock` (v5.0.0-beta.x).
 *
 * Only needed if you can't use the package's bundled types
 * (e.g. moduleResolution quirks, vendored copy, or strict ESM interop).
 * Place this file somewhere covered by your tsconfig `include`,
 * e.g. ./types/redlock.d.ts
 */
declare module 'redlock' {
  import { EventEmitter } from 'node:events';
  import type { Redis as IoredisClient, Cluster as IoredisCluster } from 'ioredis';

  /** Any client redlock can talk to (ioredis instance or cluster). */
  export type CompatibleRedisClient = IoredisClient | IoredisCluster;

  export interface Settings {
    /** Compensation for clock drift between Redis nodes, as a fraction of the TTL. Default: 0.01 */
    readonly driftFactor: number;
    /** Max number of times to retry acquiring a lock. Default: 10 */
    readonly retryCount: number;
    /** Time in ms between retry attempts. Default: 200 */
    readonly retryDelay: number;
    /** Max random jitter in ms added to each retry delay. Default: 100 */
    readonly retryJitter: number;
    /**
     * Used by `using()`: if remaining lock time drops below this threshold (ms),
     * the lock is automatically extended. Default: 500
     */
    readonly automaticExtensionThreshold: number;
  }

  /**
   * AbortSignal passed to the `using()` routine. `aborted` flips to true
   * (and `error` is set) if the lock can no longer be guaranteed,
   * e.g. automatic extension failed.
   */
  export type RedlockAbortSignal = AbortSignal & { error?: Error };

  // eslint-disable-next-line unicorn/prefer-event-target
  export default class Redlock extends EventEmitter {
    readonly clients: Set<CompatibleRedisClient>;
    readonly settings: Settings;

    constructor(
      clients: Iterable<CompatibleRedisClient>,
      settings?: Partial<Settings>,
      scripts?: {
        readonly acquireScript?: string | ((script: string) => string);
        readonly extendScript?: string | ((script: string) => string);
        readonly releaseScript?: string | ((script: string) => string);
      },
    );

    /**
     * Run `routine` while holding a lock over `resources`. The lock is
     * automatically extended while the routine runs and released afterwards.
     * Check `signal.aborted` inside the routine to detect a lost lock.
     */
    using<T>(
      resources: string[],
      duration: number,
      settings: Partial<Settings>,
      routine: (signal: RedlockAbortSignal) => Promise<T>,
    ): Promise<T>;

    using<T>(resources: string[], duration: number, routine: (signal: RedlockAbortSignal) => Promise<T>): Promise<T>;
  }
}
