import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPromiseClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_connect';

import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { NodeService } from '@wundergraph/cosmo-connect/dist/node/v1/node_connect';
import build from '../src/core/build-server.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';

let dbname = '';

describe('Authentication', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should not be possible to do any RPC call on the platform or node service without a session', async (testContext) => {
    const databaseConnectionUrl = `postgresql://postgres:changeme@localhost:5432/${dbname}`;

    const server = await build({
      logger: {
        level: 'silent',
      },
      allowedOrigins: [],
      auth: {
        secret: 'secret',
        redirectUri: 'http://localhost:3000',
        webBaseUrl: 'http://localhost:3000',
        webErrorPath: '/error',
      },
      database: {
        url: databaseConnectionUrl,
      },
      keycloak: {
        loginRealm: 'test',
        realm: 'test',
        adminUser: 'admin',
        adminPassword: 'changeme',
        apiUrl: 'http://localhost:8080',
        frontendUrl: 'http://localhost:8080',
        clientId: 'studio',
      },
      slack: {
        clientID: '',
        clientSecret: '',
      },
      s3StorageUrl: 'http://localhost:9000',
      smtpUsername: '',
      smtpPassword: '',
      redis: {
        host: 'localhost',
        port: 6379,
        password: 'test',
      },
    });

    testContext.onTestFailed(async () => {
      await server.close();
    });

    const addr = await server.listen({
      port: 0,
    });

    const transport = createConnectTransport({
      httpVersion: '1.1',
      baseUrl: addr,
    });

    const platformClient = createPromiseClient(PlatformService, transport);
    const nodeClient = createPromiseClient(NodeService, transport);

    const createPandasSubgraph = await platformClient.createFederatedSubgraph({
      name: genID('fedGraph'),
      namespace: 'default',
      labels: [genUniqueLabel()],
      routingUrl: 'http://localhost:8081',
    });

    expect(createPandasSubgraph.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);

    const getRouterConfig = await nodeClient.getLatestValidRouterConfig({
      graphName: 'test',
    });

    expect(getRouterConfig.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHENTICATED);

    await server.close();
  });
});
