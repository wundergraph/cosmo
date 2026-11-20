import { ANALYTICS_READ_RPCS } from '@wundergraph/cosmo-shared';
import type { Client } from '../../../core/client/client.js';

export { ANALYTICS_READ_RPCS } from '@wundergraph/cosmo-shared';

export type ReadOnlyAnalyticsClient = Pick<Client['platform'], (typeof ANALYTICS_READ_RPCS)[number]>;

/**
 * Narrows the platform client to the read allow-list, so an analytics tool cannot reach a write RPC.
 */
export function createReadOnlyAnalyticsClient(platform: Client['platform']): ReadOnlyAnalyticsClient {
  return Object.fromEntries(
    ANALYTICS_READ_RPCS.map((rpc) => [rpc, platform[rpc].bind(platform)]),
  ) as unknown as ReadOnlyAnalyticsClient;
}
