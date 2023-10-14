import type { ConnectRouterOptions } from '@connectrpc/connect';
import { ConnectRouter } from '@connectrpc/connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import { App } from 'octokit';
import * as schema from '../db/schema.js';
import NodeServiceImpl from './bufservices/NodeService.js';
import PlatformServiceImpl from './bufservices/PlatformService.js';
import { ClickHouseClient } from './clickhouse/index.js';
import { Authenticator } from './services/Authentication.js';
import Keycloak from './services/Keycloak.js';
import { IPlatformWebhookService } from './webhooks/PlatformWebhookService.js';

export interface RouterOptions {
  db: PostgresJsDatabase<typeof schema>;
  jwtSecret: string;
  authenticator: Authenticator;
  keycloakRealm: string;
  chClient?: ClickHouseClient;
  logger: pino.Logger;
  keycloakClient: Keycloak;
  platformWebhooks: IPlatformWebhookService;
  webBaseUrl: string;
  githubApp?: App;
  slack: { clientID?: string; clientSecret?: string };
}
const handlerOptions: Partial<ConnectRouterOptions> = {
  maxTimeoutMs: 5000,
  jsonOptions: {
    emitDefaultValues: true,
  },
};

export default (opts: RouterOptions) => {
  return (router: ConnectRouter) => {
    router.service(NodeService, NodeServiceImpl(opts), handlerOptions);
    router.service(PlatformService, PlatformServiceImpl(opts), handlerOptions);
  };
};
