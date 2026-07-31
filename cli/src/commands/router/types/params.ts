import type { Client } from '../../../core/client/client.js';

export type FetchRouterConfigParams = {
  client: Client;
  name: string;
  namespace?: string;
  graphSignKey?: string;
};
