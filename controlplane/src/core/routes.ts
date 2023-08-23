import { ConnectRouter } from '@bufbuild/connect';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import type { ConnectRouterOptions } from '@bufbuild/connect';
import * as schema from '../db/schema.js';
import PlatformServiceImpl from './bufservices/PlatformService.js';
import NodeServiceImpl from './bufservices/NodeService.js';
import { ClickHouseClient } from './clickhouse/index.js';
import { Authenticator } from './services/Authentication.js';
import { BuildConfig } from './build-server.js';

export interface RouterOptions {
  db: PostgresJsDatabase<typeof schema>;
  jwtSecret: string;
  authenticator: Authenticator;
  keycloak: BuildConfig['keycloak'];
  chClient?: ClickHouseClient;
  logger: pino.Logger;
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
