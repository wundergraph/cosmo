import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('CheckFederatedGraph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a federated graph, subgraphs, publish the schema and then check the graph for composition errors', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);
    
    const federatedGraphName = genID('fedGraph');

    const pandasSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const productsSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/products.graphql'));
    const usersSchema = await readFile(join(process.cwd(), 'test/graphql/federationV1/users.graphql'));

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: ['team=A'],
      routingUrl: 'http://localhost:8080',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    let resp = await client.createFederatedSubgraph({
      name: 'pandas',
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8081',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    let publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      schema: pandasSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'users',
      labels: [{ key: 'team', value: 'A' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'users',
      schema: usersSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.createFederatedSubgraph({
      name: 'products',
      labels: [{ key: 'team', value: 'B' }],
      routingUrl: 'http://localhost:8082',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    publishResp = await client.publishFederatedSubgraph({
      name: 'products',
      schema: productsSchema,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    let checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      labelMatchers: ['team=A'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.compositionErrors.length).toBe(0);

    checkResp = await client.checkFederatedGraph({
      name: federatedGraphName,
      labelMatchers: ['team=B'],
    });
    expect(checkResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(checkResp.compositionErrors.length).toBe(1);
    expect(checkResp.compositionErrors[0].message).toBe(
      `Extension error:\n Could not extend the type "User" because no base definition exists.`,
    );

    await server.close();
  });
});
