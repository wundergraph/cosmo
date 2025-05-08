import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { uid } from 'uid';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { TestUser, afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('Get user accessible resources', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to get user accessible resources of a admin', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });

    const subgraphName = genID('subgraph1');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphResp = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });

    expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphResp.graph).toBeDefined();
    expect(getSubgraphResp.graph?.targetId).toBeDefined();

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8081',
      labelMatchers: [joinLabel(label)],
    });

    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const getFedGraphResp = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    expect(getFedGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(getFedGraphResp.graph).toBeDefined();
    expect(getFedGraphResp.graph?.targetId).toBeDefined();

    const ids: string[] = [];
    if (getSubgraphResp.graph) {
      ids.push(getSubgraphResp.graph.targetId);
    }

    const response = await client.getUserAccessibleResources({});
    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.subgraphs[0].targetId).toBe(getSubgraphResp.graph?.targetId);
    expect(response.federatedGraphs[0].targetId).toBe(getFedGraphResp.graph?.targetId);

    await server.close();
  });

  // TODO: I'm disabling this test as the new RBAC system populates the list of resources dynamically based
  //  on hierarchy, which we can't do at the time because the test `AuthContext`s are static
  // test('Should be able to get user accessible resources of a developer', async (testContext) => {
  //   const { client, server, authenticator } = await SetupTest({
  //     dbname,
  //     enabledFeatures: ['rbac'],
  //     enableMultiUsers: true,
  //   });
  //
  //   authenticator.changeUser(TestUser.devJoeCompanyA);
  //
  //   const subgraphName = genID('subgraph1');
  //   const fedGraphName = genID('fedGraph');
  //   const label = genUniqueLabel();
  //
  //   const createSubgraphResp = await client.createFederatedSubgraph({
  //     name: subgraphName,
  //     namespace: 'default',
  //     labels: [label],
  //     routingUrl: 'http://localhost:8080',
  //   });
  //
  //   expect(createSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
  //
  //   const getSubgraphResp = await client.getSubgraphByName({
  //     name: subgraphName,
  //     namespace: 'default',
  //   });
  //
  //   expect(getSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
  //   expect(getSubgraphResp.graph).toBeDefined();
  //   expect(getSubgraphResp.graph?.targetId).toBeDefined();
  //
  //   const createFedGraphRes = await client.createFederatedGraph({
  //     name: fedGraphName,
  //     namespace: 'default',
  //     routingUrl: 'http://localhost:8081',
  //     labelMatchers: [joinLabel(label)],
  //   });
  //
  //   expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);
  //
  //   const getFedGraphResp = await client.getFederatedGraphByName({
  //     name: fedGraphName,
  //     namespace: 'default',
  //   });
  //
  //   expect(getFedGraphResp.response?.code).toBe(EnumStatusCode.OK);
  //   expect(getFedGraphResp.graph).toBeDefined();
  //   expect(getFedGraphResp.graph?.targetId).toBeDefined();
  //
  //   const ids: string[] = [];
  //   if (getSubgraphResp.graph) {
  //     ids.push(getSubgraphResp.graph.targetId);
  //   }
  //
  //   const response = await client.getUserAccessibleResources({});
  //   expect(response.response?.code).toBe(EnumStatusCode.OK);
  //   expect(response.subgraphs[0].targetId).toBe(getSubgraphResp.graph?.targetId);
  //   expect(response.federatedGraphs[0].targetId).toBe(getFedGraphResp.graph?.targetId);
  //
  //   await server.close();
  // });
});
