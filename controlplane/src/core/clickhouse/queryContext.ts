import { AsyncLocalStorage } from 'node:async_hooks';

export type ClickHouseQueryContext = {
  rpc: string;
  organizationId?: string;
  actorId?: string;
  client?: string;
  signal?: AbortSignal;
};

/**
 * Carries the current RPC request into every ClickHouse query it makes, so queries are tagged in
 * `system.query_log` (`log_comment`, `query_id`) and cancelled when the client goes away.
 */
export const clickHouseQueryContext = new AsyncLocalStorage<ClickHouseQueryContext>();

export function setQueryContextActor(organizationId: string, actorId?: string): void {
  const store = clickHouseQueryContext.getStore();
  if (!store) {
    return;
  }
  store.organizationId = organizationId;
  store.actorId = actorId;
}
