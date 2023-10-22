import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  genID,
  genUniqueLabel,
} from '../src/core/test-util';
import { SetupTest } from './test-util';

let dbname = '';

describe('DeleteSubgraph', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create a subgraph, publish the schema, create a federated graph and then delete a subgraph', async (testContext) => {
    const { client, server } = await SetupTest(testContext, dbname);
    
    const federatedGraphName = genID('fedGraph');
    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:4000',
    });

    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishFederatedSubgraphResp = await client.publishFederatedSubgraph({
      name: subgraphName,
      schema: Uint8Array.from(Buffer.from('type Query { hello: String! }')),
    });

    expect(publishFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // delete the subgraph
    const deleteFederatedSubgraphResp = await client.deleteFederatedSubgraph({
      subgraphName,
    });
    expect(deleteFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    // after deletion of subgraph verify if the subgraph was deleted
    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
    });
    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    // after deletion of subgraph verify if the federated graph exists
    const getFederatedGraphResp = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });
    expect(getFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });
});
