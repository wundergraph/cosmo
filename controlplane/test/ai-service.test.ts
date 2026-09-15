import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Client, ConnectError } from '@connectrpc/connect';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { DEFAULT_ROUTER_URL, SetupTest } from './test-util.js';

let dbname = '';

async function generateGraphToken(client: Client<typeof PlatformService>) {
  const namespace = genID('namespace').toLowerCase();
  const graphName = genID('graph');

  // Create a namespace
  const createNamespaceResp = await client.createNamespace({ name: namespace });
  expect(createNamespaceResp.response?.code).toBe(EnumStatusCode.OK);

  // Create a federated graph
  const createGraphResp = await client.createFederatedGraph({
    name: graphName,
    namespace,
    routingUrl: DEFAULT_ROUTER_URL,
  });

  expect(createGraphResp.response?.code).toBe(EnumStatusCode.OK);

  // Generate a router token for the graph
  const genRouterTokenResp = await client.generateRouterToken({
    namespace,
    fedGraphName: graphName,
  });

  expect(genRouterTokenResp.response?.code).toBe(EnumStatusCode.OK);

  return genRouterTokenResp.token;
}

describe('AIService', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('GenerateQuery', () => {
    test('should return unauthorized when no router token is provided', async (testContext) => {
      const { aiClient, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      try {
        await aiClient.generateQuery({
          prompt: 'List all employees',
          version: 'v1',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectError);
        return;
      }

      // We expect this branch to never be reached
      expect(false).toBe(true);
    });

    test('should return error when service not configured', async (testContext) => {
      const { client, aiClient, server } = await SetupTest({ dbname });
      testContext.onTestFinished(() => server.close());

      const token = await generateGraphToken(client);

      const headers = new Headers();
      headers.set('authorization', `bearer ${token}`);

      const resp = await aiClient.generateQuery(
        {
          prompt: 'List all employees',
          version: 'v1',
        },
        { headers },
      );

      expect(resp.response?.code).toBe(EnumStatusCode.ERR);
      expect(resp.response?.details).toBe('The Prompt to Query service have not been configured');
    });
  });
});
