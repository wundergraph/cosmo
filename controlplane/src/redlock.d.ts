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

  /** Per-client outcome of an attempt against one Redis node. */
  export type ClientExecutionResult =
    | {
        client: CompatibleRedisClient;
        vote: 'for';
        value: number;
      }
    | {
        client: CompatibleRedisClient;
        vote: 'against';
        error: Error;
      };

  /** Aggregated stats for a single acquisition/extension/release attempt. */
  export interface ExecutionStats {
    readonly membershipSize: number;
    readonly quorumSize: number;
    readonly votesFor: Set<CompatibleRedisClient>;
    readonly votesAgainst: Map<CompatibleRedisClient, Error>;
  }

  export interface ExecutionResult {
    attempts: ReadonlyArray<Promise<ExecutionStats>>;
    start: number;
  }

  /**
   * Thrown (internally, surfaced via the `error` event) when a resource
   * is already locked on a specific client. Usually safe to ignore.
   */
  export class ResourceLockedError extends Error {
    readonly message: string;
    constructor(message: string);
  }

  /**
   * Thrown when an operation (acquire/extend/release) fails overall,
   * e.g. quorum was not reached or retries were exhausted.
   */
  export class ExecutionError extends Error {
    readonly message: string;
    readonly attempts: ReadonlyArray<Promise<ExecutionStats>>;
    constructor(message: string, attempts: ReadonlyArray<Promise<ExecutionStats>>);
  }

  /** A held lock. Returned by `acquire()` and `extend()`. */
  export class Lock {
    readonly redlock: Redlock;
    readonly resources: string[];
    readonly value: string;
    readonly attempts: ReadonlyArray<Promise<ExecutionStats>>;
    /** Unix timestamp (ms) at which the lock expires. */
    expiration: number;

    constructor(
      redlock: Redlock,
      resources: string[],
      value: string,
      attempts: ReadonlyArray<Promise<ExecutionStats>>,
      expiration: number,
    );

    release(): Promise<ExecutionResult>;
    extend(duration: number): Promise<Lock>;
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
     * Acquire a lock over the given resources for `duration` milliseconds.
     * Rejects with ExecutionError if the lock cannot be acquired.
     */
    acquire(resources: string[], duration: number, settings?: Partial<Settings>): Promise<Lock>;

    /** Release a held lock on all clients. */
    release(lock: Lock, settings?: Partial<Settings>): Promise<ExecutionResult>;

    /** Extend a held (non-expired) lock by `duration` milliseconds. */
    extend(existing: Lock, duration: number, settings?: Partial<Settings>): Promise<Lock>;

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

    /** Disconnect all underlying Redis clients. */
    quit(): Promise<void>;

    // Typed event emitter surface
    on(event: 'error', listener: (error: Error) => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
    off(event: 'error', listener: (error: Error) => void): this;
  }
}
