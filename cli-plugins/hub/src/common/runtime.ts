import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PluginContext } from '@wundergraph/wgc-plugin-sdk';
import { openWebSocket } from './portal-tunnel.js';
import type { TunnelSocket } from './portal-tunnel.js';

/** What the hub commands take from the process, so tests can fix the clock, the cwd and Ctrl-C. */
export interface HubRuntime {
  cwd: () => string;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  /** Calls `listener` on Ctrl-C until the returned function is called. */
  onInterrupt: (listener: () => void) => () => void;
  newIdempotencyKey: () => string;
  /** Opens a portal tunnel to Hub. */
  openSocket: (url: string) => TunnelSocket;
}

export interface HubDependencies {
  context: PluginContext;
  runtime: HubRuntime;
}

export const processRuntime = (): HubRuntime => ({
  cwd: () => process.cwd(),
  env: process.env,
  now: () => new Date(),
  sleep: async (milliseconds) => {
    await delay(milliseconds);
  },
  onInterrupt: (listener) => {
    process.once('SIGINT', listener);
    return () => {
      process.off('SIGINT', listener);
    };
  },
  newIdempotencyKey: () => randomUUID(),
  openSocket: openWebSocket,
});
