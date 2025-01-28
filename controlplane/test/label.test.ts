import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { Label } from '../src/types/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import { createFederatedGraph, createThenPublishSubgraph, SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Labels', (ctx) => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Changing labels of federated should reassign subgraphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph1');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      'default',
      subgraphSchemaSDL,
      [label1],
      'http://localhost:8081',
    );
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      'default',
      subgraphSchemaSDL,
      [label2],
      'http://localhost:8082',
    );

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label1)],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });

    // Only the subgraph1 should be assigned to the federated graph
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);

    // This will exclude subgraph1 from the federated graph and add subgraph2
    const updateRes = await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label2)],
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.OK);

    const updatedGraph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(updatedGraph.response?.code).toBe(EnumStatusCode.OK);

    // Only the subgraph2 should be assigned to the federated graph
    expect(updatedGraph.subgraphs.length).toBe(1);
    expect(updatedGraph.subgraphs[0].name).toBe(subgraph2Name);

    await server.close();
  });

  test('Changing labels of subgraph should affect federated graphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const fedGraph3Name = genID('fedGraph3');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');
    const label3 = genUniqueLabel('label3');

    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label1)], 'http://localhost:8081');
    await createFederatedGraph(client, fedGraph2Name, 'default', [joinLabel(label2)], 'http://localhost:8082');

    // This federated graph should be unaffected by the label changes in the tests
    await createFederatedGraph(client, fedGraph3Name, 'default', [joinLabel(label3)], 'http://localhost:8083');

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
        namespace: 'default',
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        namespace: 'default',
        schema: `type Query { name: String! }`,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8083');
    await createSubgraph(subgraph2Name, [label2], 'http://localhost:8084');

    // fedGraph1 should have subgraph1 and fedGraph2 should have subgraph2
    const graph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1.subgraphs.length).toBe(1);
    expect(graph1.subgraphs[0].name).toBe(subgraph1Name);

    const graph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });

    expect(graph2.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2.subgraphs.length).toBe(1);
    expect(graph2.subgraphs[0].name).toBe(subgraph2Name);

    // This will remove the subgraph1 from fedGraph1 and add subgraph1 to fedGraph2
    // This results in a federated graph with no subgraphs which is not allowed
    const updateRes1 = await client.updateSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label2],
    });
    expect(updateRes1.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(updateRes1.compositionErrors.length).gt(0);
    expect(updateRes1.compositionErrors[0].message).toBe('At least one subgraph is required for federation.');

    let updatedGraph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(updatedGraph1.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedGraph1.subgraphs.length).toBe(0);

    // This will remove the subgraph2 from fedGraph2 and add subgraph1 to fedGraph2
    const updateRes2 = await client.updateSubgraph({
      name: subgraph2Name,
      namespace: 'default',
      labels: [label1],
    });
    expect(updateRes2.response?.code).toBe(EnumStatusCode.OK);

    // fedGraph1 should have subgraph2 and fedGraph2 should have subgraph1
    updatedGraph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(updatedGraph1.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedGraph1.subgraphs.length).toBe(1);
    expect(updatedGraph1.subgraphs[0].name).toBe(subgraph2Name);

    const updatedGraph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(updatedGraph2.response?.code).toBe(EnumStatusCode.OK);
    expect(updatedGraph2.subgraphs.length).toBe(1);
    expect(updatedGraph2.subgraphs[0].name).toBe(subgraph1Name);

    const federatedGraph3 = await client.getFederatedGraphByName({
      name: fedGraph3Name,
      namespace: 'default',
    });
    expect(federatedGraph3.response?.code).toBe(EnumStatusCode.OK);
    expect(federatedGraph3.subgraphs.length).toBe(0);

    await server.close();
  });

  test('Assign graphs with multiple label matchers correctly', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const subgraph3Name = genID('subgraph3');
    const fedGraphName = genID('fedGraph1');
    const labelTeamA = genUniqueLabel('teamA');
    const labelTeamB = genUniqueLabel('teamB');
    const labelTeamC = genUniqueLabel('teamC');
    const labelEnvProd = genUniqueLabel('envProd');
    const labelEnvDev = genUniqueLabel('envDev');
    const labelProviderAWS = genUniqueLabel('providerAWS');

    // Federated Graph
    // --label-matcher team=A,team=B,team=C --label-matcher env=prod
    // Subgraphs
    // 1. --labels team=A,provider=aws,env=prod
    // 2. --labels team=B,env=prod
    // 3. --labels team=C,env=dev
    // This will create a federated graph consists of subgraphs 1 and 2 with labels team=A,team=B and env=prod

    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      'default',
      subgraphSchemaSDL,
      [labelTeamA, labelProviderAWS, labelEnvProd],
      'http://localhost:8081',
    );
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      'default',
      subgraphSchemaSDL,
      [labelTeamB, labelEnvProd],
      'http://localhost:8082',
    );
    await createThenPublishSubgraph(
      client,
      subgraph3Name,
      'default',
      subgraphSchemaSDL,
      [labelTeamC, labelEnvDev],
      'http://localhost:8082',
    );

    const createFedGraphRes = await client.createFederatedGraph({
      name: fedGraphName,
      namespace: 'default',
      routingUrl: 'http://localhost:8080',
      labelMatchers: [
        [joinLabel(labelTeamA), joinLabel(labelTeamB), joinLabel(labelTeamC)].join(','),
        joinLabel(labelEnvProd),
      ],
    });
    expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);
    expect(graph.subgraphs.length).toBe(2);
    expect(graph.subgraphs[0].name).toBe(subgraph1Name);
    expect(graph.subgraphs[1].name).toBe(subgraph2Name);

    await server.close();
  });

  test('Graphs with empty label matchers should only compose subgraphs with empty labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');

    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label1)], 'http://localhost:8081');
    await createFederatedGraph(client, fedGraph2Name, 'default', [], 'http://localhost:8082');

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
        namespace: 'default',
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        namespace: 'default',
        schema: `type Query { name: String! }`,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8083');
    await createSubgraph(subgraph2Name, [], 'http://localhost:8084');

    // fedGraph1 should have subgraph1 and fedGraph2 should have subgraph2
    const graph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1.subgraphs.length).toBe(1);
    expect(graph1.subgraphs[0].name).toBe(subgraph1Name);

    const graph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2.subgraphs.length).toBe(1);
    expect(graph2.subgraphs[0].name).toBe(subgraph2Name);

    await server.close();
  });

  // Create 2 Graphs and 2 subgraphs
  // 1 with and without labels in each type
  // Unset the labels of subgraph
  // The graph with empty matchers should have both subgraphs and the other should have none
  test('Should compose correct subgraphs after unsetting subgraph labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label1)], 'http://localhost:8081');
    await createFederatedGraph(client, fedGraph2Name, 'default', [], 'http://localhost:8082');

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
        namespace: 'default',
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        namespace: 'default',
        schema: `type Query { name: String! }`,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8083');
    await createSubgraph(subgraph2Name, [], 'http://localhost:8084');

    // fedGraph1 should have subgraph1 and fedGraph2 should have subgraph2
    const graph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1.subgraphs.length).toBe(1);
    expect(graph1.subgraphs[0].name).toBe(subgraph1Name);

    const graph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2.subgraphs.length).toBe(1);
    expect(graph2.subgraphs[0].name).toBe(subgraph2Name);

    await client.updateSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      unsetLabels: true,
      labels: [label2], // We pass this to make sure that new labels are not created when unsetting
    });

    const subgraph2 = await client.getSubgraphByName({
      name: subgraph1Name,
      namespace: 'default',
    });
    expect(subgraph2.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraph2.graph?.labels.length).toBe(0);

    // fedGraph1 should have no subgraphs and fedGraph2 should have subgraph1 and subgraph2
    const graph1AfterUnset = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1AfterUnset.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1AfterUnset.subgraphs.length).toBe(0);

    const graph2AfterUnset = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2AfterUnset.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2AfterUnset.subgraphs.length).toBe(2);

    await server.close();
  });

  // Create 2 Graphs and 2 subgraphs
  // 1 with and without labels in each type
  // Unset the matchers of graph
  // Both graphs should have the subgraph with no labels
  test('Should compose correct subgraphs after unsetting graph label matchers', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label1)], 'http://localhost:8081');
    await createFederatedGraph(client, fedGraph2Name, 'default', [], 'http://localhost:8082');

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
        namespace: 'default',
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        namespace: 'default',
        schema: `type Query { name: String! }`,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8083');
    await createSubgraph(subgraph2Name, [], 'http://localhost:8084');

    // fedGraph1 should have subgraph1 and fedGraph2 should have subgraph2
    const graph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1.subgraphs.length).toBe(1);
    expect(graph1.subgraphs[0].name).toBe(subgraph1Name);

    const graph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2.subgraphs.length).toBe(1);
    expect(graph2.subgraphs[0].name).toBe(subgraph2Name);

    await client.updateFederatedGraph({
      name: fedGraph1Name,
      namespace: 'default',
      unsetLabelMatchers: true,
      labelMatchers: [joinLabel(label2)], // We pass this to make sure that new label matchers are not created when unsetting
    });

    // fedGraph1 should have subgraph2
    const graph1AfterUnset = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1AfterUnset.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1AfterUnset.graph?.labelMatchers.length).toBe(0);
    expect(graph1AfterUnset.subgraphs.length).toBe(1);
    expect(graph1AfterUnset.subgraphs[0].name).toBe(subgraph2Name);

    await server.close();
  });

  // Create 2 Graphs and 2 subgraphs
  // 1 with and without labels in each type
  // Unset the labels of the subgraph with labels
  // Graph without matchers will now have 2 subgraphs and the other one will have no subgraphs
  // Now set a label again to the subgraph
  // Each graph will have 1 subgraph
  test('Should compose correct subgraph after unsetting and re-adding subgraph labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const fedGraph1Name = genID('fedGraph1');
    const fedGraph2Name = genID('fedGraph2');
    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const label1 = genUniqueLabel('label1');

    await createFederatedGraph(client, fedGraph1Name, 'default', [joinLabel(label1)], 'http://localhost:8081');
    await createFederatedGraph(client, fedGraph2Name, 'default', [], 'http://localhost:8082');

    const createSubgraph = async (name: string, labels: Label[], routingUrl: string) => {
      const createRes = await client.createFederatedSubgraph({
        name,
        labels,
        routingUrl,
        namespace: 'default',
      });
      expect(createRes.response?.code).toBe(EnumStatusCode.OK);
      const publishResp = await client.publishFederatedSubgraph({
        name,
        namespace: 'default',
        schema: `type Query { name: String! }`,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    };

    await createSubgraph(subgraph1Name, [label1], 'http://localhost:8083');
    await createSubgraph(subgraph2Name, [], 'http://localhost:8084');

    // fedGraph1 should have subgraph1 and fedGraph2 should have subgraph2
    const graph1 = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1.subgraphs.length).toBe(1);
    expect(graph1.subgraphs[0].name).toBe(subgraph1Name);

    const graph2 = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2.subgraphs.length).toBe(1);
    expect(graph2.subgraphs[0].name).toBe(subgraph2Name);

    await client.updateSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      unsetLabels: true,
    });

    // fedGraph1 should have 0 subgraphs and fedGraph2 should have 2 subgraphs
    const graph1AfterUnset = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1AfterUnset.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1AfterUnset.subgraphs.length).toBe(0);

    const graph2AfterUnset = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2AfterUnset.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2AfterUnset.subgraphs.length).toBe(2);

    await client.updateSubgraph({
      name: subgraph1Name,
      namespace: 'default',
      labels: [label1],
    });

    // fedGraph1 should have 1 subgraph and fedGraph2 should have 1 subgraph
    const graph1AfterSet = await client.getFederatedGraphByName({
      name: fedGraph1Name,
      namespace: 'default',
    });
    expect(graph1AfterSet.response?.code).toBe(EnumStatusCode.OK);
    expect(graph1AfterSet.subgraphs.length).toBe(1);

    const graph2AfterSet = await client.getFederatedGraphByName({
      name: fedGraph2Name,
      namespace: 'default',
    });
    expect(graph2AfterSet.response?.code).toBe(EnumStatusCode.OK);
    expect(graph2AfterSet.subgraphs.length).toBe(1);

    await server.close();
  });
});
