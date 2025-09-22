import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { RouterConfig } from '@wundergraph/cosmo-connect/dist/node/v1/node_pb';
import { normalizeString } from '@wundergraph/composition/tests/utils/utils.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../src/core/test-util.js';
import { unsuccessfulBaseCompositionError } from '../src/core/errors/errors.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import {
  assertFeatureFlagExecutionConfig,
  assertNumberOfCompositions,
  createAndPublishSubgraph,
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from './test-util.js';

const schemaDefinition = `schema {\n  query: Query\n}\n\n`
let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Contract tests', () => {
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

  test('that a contract is created for a federated graph with excluded tags', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const fedGraphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(fedGraphRes.graph?.name).toBe(fedGraphName);

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.namespace).toBe(DEFAULT_NAMESPACE);
    expect(contractGraphRes.subgraphs.length).toBe(1);
    expect(contractGraphRes.subgraphs[0].name).toBe(subgraphName);
    expect(contractGraphRes.graph?.contract?.sourceFederatedGraphId).toBe(fedGraphRes.graph?.id);
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual(['test']);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual([]);
    expect(contractGraphRes.graph?.labelMatchers).toEqual(fedGraphRes.graph?.labelMatchers);
    expect(contractGraphRes.graph?.routingURL).toBe('http://localhost:8081');
    expect(contractGraphRes.graph?.readme).toBe('test');
    expect(contractGraphRes.graph?.supportsFederation).toEqual(true);
    expect(blobStorage.keys().length).toBe(2);

    await server.close();
  });

  test('that a contract is created for a federated graph with included tags', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const fedGraphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(fedGraphRes.graph?.name).toBe(fedGraphName);

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.namespace).toBe(DEFAULT_NAMESPACE);
    expect(contractGraphRes.subgraphs.length).toBe(1);
    expect(contractGraphRes.subgraphs[0].name).toBe(subgraphName);
    expect(contractGraphRes.graph?.contract?.sourceFederatedGraphId).toBe(fedGraphRes.graph?.id);
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual(['test']);
    expect(contractGraphRes.graph?.labelMatchers).toEqual(fedGraphRes.graph?.labelMatchers);
    expect(contractGraphRes.graph?.routingURL).toBe('http://localhost:8081');
    expect(contractGraphRes.graph?.readme).toBe('test');
    expect(contractGraphRes.graph?.supportsFederation).toEqual(true);
    expect(blobStorage.keys().length).toBe(2);

    await server.close();
  });

  test('that an error is returned if a contract is created with both excluded and included tags', async () => {
    const { client, server, } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const createContractResponse = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['exclude'],
      includeTags: ['include'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    expect(createContractResponse.response?.code).toBe(1);
    expect(createContractResponse.response?.details).toBe(
      `The "exclude" and "include" options for tags are currently mutually exclusive.` +
        ` Both options have been provided, but one of the options must be empty or unset.`,
    );

    await server.close();
  });

  test('that the exclude tags of a contract are updated', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual(['test']);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual([]);

    await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      excludeTags: ['new'],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual(['new']);
    expect(contractGraphUpdatedRes.graph?.contract?.includeTags).toEqual([]);

    await server.close();
  });

  test('that the include tags of a contract are updated', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual(['test']);

    await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      includeTags: ['new'],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphUpdatedRes.graph?.contract?.includeTags).toEqual(['new']);

    await server.close();
  });

  test('that an error is returned if a contract is updated with both excludes and includes', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual(['test']);

    const updateContractResponse = await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      excludeTags: ['test'],
      includeTags: ['new'],
    });

    expect(updateContractResponse.response?.code).toBe(1);
    expect(updateContractResponse.response?.details).toBe(
      `The "exclude" and "include" options for tags are currently mutually exclusive.` +
        ` Both options have been provided, but one of the options must be empty or unset.`,
    );

    await server.close();
  });

  test('that contract tags are updated from exclude to include', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual(['test']);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual([]);

    await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      includeTags: ['new'],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphUpdatedRes.graph?.contract?.includeTags).toEqual(['new']);

    await server.close();
  });

  test('that contract tags are updated from include to exclude', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual(['test']);

    await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      excludeTags: ['new'],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual(['new']);
    expect(contractGraphUpdatedRes.graph?.contract?.includeTags).toEqual([]);

    await server.close();
  });

  test('that contract routing url and readme is updated', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract?.excludeTags).toEqual([]);
    expect(contractGraphRes.graph?.contract?.includeTags).toEqual(['test']);

    await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      excludeTags: ['new'],
      readme: 'new',
      routingUrl: 'http://localhost:8082',
    });

    let contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual(['new']);
    expect(contractGraphUpdatedRes.graph?.contract?.includeTags).toEqual([]);
    expect(contractGraphUpdatedRes.graph?.readme).toEqual('new');
    expect(contractGraphUpdatedRes.graph?.routingURL).toEqual('http://localhost:8082');

    await client.updateContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      excludeTags: ['new'],
      readme: '',
    });

    contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.contract?.excludeTags).toEqual(['new']);
    expect(contractGraphUpdatedRes.graph?.contract?.includeTags).toEqual([]);
    expect(contractGraphUpdatedRes.graph?.routingURL).toEqual('http://localhost:8082');
    expect(contractGraphUpdatedRes.graph?.readme).toBeUndefined();

    await server.close();
  });

  test('that contract is deleted upon deleting source federated graph', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract).toBeDefined();

    expect(blobStorage.keys().length).toBe(2);

    await client.deleteFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });

    const contractGraphDeletedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphDeletedRes.response?.code).toEqual(EnumStatusCode.ERR_NOT_FOUND);

    expect(blobStorage.keys().length).toBe(0);

    await server.close();
  });

  test('that label matcher update on source federated graph propagates to contract graphs with exclude tags', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const label2 = genUniqueLabel('label2');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract).toBeDefined();

    await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label), joinLabel(label2)],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.labelMatchers).toEqual([joinLabel(label), joinLabel(label2)]);

    await server.close();
  });

  test('that label matcher update on source federated graph propagates to contract graphs with include tags', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const label2 = genUniqueLabel('label2');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const contractGraphRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphRes.graph?.contract).toBeDefined();

    await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label), joinLabel(label2)],
    });

    const contractGraphUpdatedRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(contractGraphUpdatedRes.graph?.labelMatchers).toEqual([joinLabel(label), joinLabel(label2)]);

    await server.close();
  });

  test('that label matcher update should not be possible for contract graphs', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const label2 = genUniqueLabel('label2');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const res = await client.updateFederatedGraph({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label), joinLabel(label2)],
    });

    expect(res.response?.code).toEqual(EnumStatusCode.ERR);

    await server.close();
  });

  test('that moving source federated graph moves contract graph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const prod = 'prod';

    await client.createNamespace({
      name: prod,
    });

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );
    await createThenPublishSubgraph(client, subgraphName, prod, subgraphSchemaSDL, [label], 'http://localhost:8082');

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const moveRes = await client.moveFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: prod,
    });
    expect(moveRes.response?.code).toEqual(EnumStatusCode.OK);

    const contractResAfterMove = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: prod,
    });
    expect(contractResAfterMove.response?.code).toEqual(EnumStatusCode.OK);

    await server.close();
  });

  test('that moving contract federated graph is not allowed', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');
    const prod = 'prod';

    await client.createNamespace({
      name: prod,
    });

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const moveRes = await client.moveFederatedGraph({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: prod,
    });
    expect(moveRes.response?.code).toEqual(EnumStatusCode.ERR);

    await server.close();
  });

  test('that contract graph for a monograph is also a monograph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.OK);
    expect(getContractRes.graph?.supportsFederation).toEqual(false);
    expect(getContractRes.subgraphs.length).toEqual(1);

    await server.close();
  });

  test('that moving source monograph also moves contract graph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');
    const prod = 'prod';

    await client.createNamespace({
      name: prod,
    });

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const moveRes = await client.moveMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: prod,
    });
    expect(moveRes.response?.code).toEqual(EnumStatusCode.OK);

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: prod,
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.OK);
    expect(getContractRes.subgraphs.length).toEqual(1);

    await server.close();
  });

  test('that contract is deleted upon deleting source monograph', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const publishRes1 = await client.publishMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String!, hi: String! @tag(name: "test"), test: String! }',
    });
    expect(publishRes1.response?.code).toEqual(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    expect(blobStorage.keys().length).toBe(2);

    const deleteRes = await client.deleteMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(deleteRes.response?.code).toEqual(EnumStatusCode.OK);

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.ERR_NOT_FOUND);

    expect(blobStorage.keys().length).toBe(0);

    await server.close();
  });

  test('that contract is migrated upon migrating monograph', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
      readme: 'test',
    });

    const migrateRes = await client.migrateMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(migrateRes.response?.code).toEqual(EnumStatusCode.OK);

    const getContractRes = await client.getFederatedGraphByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getContractRes.response?.code).toEqual(EnumStatusCode.OK);
    expect(getContractRes.graph?.supportsFederation).toEqual(true);

    await server.close();
  });

  test('that publishing subgraph recomposes contract with exclude tags', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
}`);

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String!, hi: String! }',
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {\n  hello: String!\n  hi: String!\n}`);

    await server.close();
  });

  test('that publishing subgraph recomposes contract with include tags', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraphSchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {\n  hi: String!\n}`);

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String!, hi: String! }',
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {\n  hi: String!\n}`);

    await server.close();
  });

  test('that deleting subgraph recomposes contract with exclude tags', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label],
      'http://localhost:8082',
    );
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label],
      'http://localhost:8083',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
  test: String!
}`);

    await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
}`);

    await server.close();
  });

  test('that deleting subgraph recomposes contract with include tags', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label],
      'http://localhost:8082',
    );
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label],
      'http://localhost:8083',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      includeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {\n  hi: String!\n}`);

    await client.deleteFederatedSubgraph({
      subgraphName: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {\n  hi: String!\n}`);

    await server.close();
  });

  test('that moving a constituent subgraph recomposes its contract', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label = genUniqueLabel('label');

    await client.createNamespace({
      name: 'prod',
    });

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label],
      'http://localhost:8082',
    );
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label],
      'http://localhost:8083',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
  test: String!
}`);

    await client.moveSubgraph({
      name: subgraph2Name,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: 'prod',
    });

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
}`);

    await server.close();
  });

  test('that publishing a monograph recomposes its contract', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const monographName = genID('monograph');
    const contractGraphName = genID('contract');

    const monographSchema = 'type Query { hello: String!, hi: String! @tag(name: "test"), test: String! }';

    const createResp = await client.createMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      graphUrl: 'http://localhost:4000',
      routingUrl: 'http://localhost:3002',
    });
    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const publishRes1 = await client.publishMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      schema: monographSchema,
    });
    expect(publishRes1.response?.code).toEqual(EnumStatusCode.OK);

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: monographName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
  test: String!
}`);

    const publishRes2 = await client.publishMonograph({
      name: monographName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String!, hi: String! @tag(name: "test") }',
    });
    expect(publishRes2.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
}`);

    await server.close();
  });

  test('that updating label matchers of a source federated graph recomposes its contract', async () => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const contractGraphName = genID('contract');
    const label1 = genUniqueLabel('label1');
    const label2 = genUniqueLabel('label2');

    await client.createNamespace({
      name: 'prod',
    });

    const subgraph1SchemaSDL = 'type Query { hello: String!, hi: String! @tag(name: "test") }';
    const subgraph2SchemaSDL = 'type Query { test: String! }';

    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraph1SchemaSDL,
      [label1],
      'http://localhost:8082',
    );
    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      subgraph2SchemaSDL,
      [label2],
      'http://localhost:8083',
    );

    await createFederatedGraph(
      client,
      fedGraphName,
      DEFAULT_NAMESPACE,
      [[joinLabel(label1), joinLabel(label2)].join(',')],
      'http://localhost:8080',
    );

    const res = await client.createContract({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphName,
      excludeTags: ['test'],
      routingUrl: 'http://localhost:8081',
    });
    expect(res.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse.clientSchema).toEqual(schemaDefinition + `type Query {
  hello: String!
  test: String!
}`);

    const updateRes = await client.updateFederatedGraph({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      labelMatchers: [joinLabel(label1)],
    });
    expect(updateRes.response?.code).toEqual(EnumStatusCode.OK);

    const sdlResponse2 = await client.getFederatedGraphSDLByName({
      name: contractGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(sdlResponse2.response?.code).toEqual(EnumStatusCode.OK);
    expect(sdlResponse2.clientSchema).toEqual(schemaDefinition + `type Query {\n  hello: String!\n}`);

    await server.close();
  });

  test('that a contract is not produced if its source graph does not compose successfully', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = genID('baseGraphName');
    const label = genUniqueLabel('label');
    const labels = [label];
    await createFederatedGraph(client, baseGraphName, namespace, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    const publishSubgraphResponse = await client.publishFederatedSubgraph({
      name: 'products',
      namespace,
      labels,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-failing.graphql`)).toString(),
    });
    expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

    const baseGraphResponse = await client.getFederatedGraphByName({
      name: baseGraphName,
      namespace,
    });

    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);
    // Two subgraph publishes for two compositions, the last of which is failing
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const contractName = genID('contractName');
    const createContractResponse = await client.createContract({
      name: contractName,
      namespace,
      sourceGraphName: baseGraphName,
      excludeTags: ['exclude'],
      routingUrl: 'http://localhost:3004',
    });
    expect(createContractResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(createContractResponse.response?.details).toBe(
      `The source graph "${baseGraphName}" is not currently composable.` +
        ` A contract can only be created if its respective source graph has composed successfully.`,
    );

    // There should still only be a single key in storage
    expect(blobStorage.keys()).toHaveLength(1);
    // The contract is rejected, so compositions should return ERR_NOT_FOUND and 0 compositions
    await assertNumberOfCompositions(client, contractName, 0, namespace, EnumStatusCode.ERR_NOT_FOUND);
    // The base graph compositions should remain at 2
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    await server.close();
  });

  test('that updating a contract whose source graph has not successfully composed produces a composition error', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = genID('baseGraphName');
    const label = genUniqueLabel('label');
    const labels = [label];
    await createFederatedGraph(client, baseGraphName, namespace, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users-update.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createAndPublishSubgraph(
      client,
      'products',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const baseGraphResponse = await client.getFederatedGraphByName({
      name: baseGraphName,
      namespace,
    });

    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);
    // Two subgraph publishes for two compositions
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const contractName = genID('contractName');
    const createContractResponse = await client.createContract({
      name: contractName,
      namespace,
      sourceGraphName: baseGraphName,
      excludeTags: ['exclude'],
      routingUrl: 'http://localhost:3004',
    });
    expect(createContractResponse.response?.code).toBe(EnumStatusCode.OK);

    const contractResponse = await client.getFederatedGraphByName({
      name: contractName,
      namespace,
    });

    // There should be two keys (the source graph and the contract)
    expect(blobStorage.keys()).toHaveLength(2);
    const contractKey = blobStorage.keys()[1];
    expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);

    // There should be a composition for the contract
    await assertNumberOfCompositions(client, contractName, 1, namespace);
    // The source graph compositions should remain at two
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const failingPublishSubgraphResponse = await client.publishFederatedSubgraph({
      name: 'products',
      namespace,
      labels,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      schema: fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/products-failing.graphql`)).toString(),
    });
    expect(failingPublishSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(failingPublishSubgraphResponse.compositionErrors).toHaveLength(2);
    expect(failingPublishSubgraphResponse.compositionErrors[1]).toStrictEqual(
      unsuccessfulBaseCompositionError(baseGraphName, namespace),
    );

    // The contract composition should remain at one
    await assertNumberOfCompositions(client, contractName, 1, namespace);
    // The source graph compositions should now be at three
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

    // Attempt to update the contract while the source graph is uncomposable
    const updateContractResponse = await client.updateContract({
      name: contractName,
      namespace,
      excludeTags: ['exclude', 'newTag'],
    });
    expect(updateContractResponse.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(updateContractResponse.compositionErrors).toHaveLength(1);

    // There should be one more (failing) contract composition
    await assertNumberOfCompositions(client, contractName, 2, namespace);
    // The source graph compositions should remain at three
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);

    await server.close();
  });

  test('that a contract with exclude tags uploads the correct client schema to the router', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = genID('baseGraphName');
    const label = genUniqueLabel('label');
    const labels = [label];
    await createFederatedGraph(client, baseGraphName, namespace, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/contracts/users.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createAndPublishSubgraph(
      client,
      'products',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/contracts/products.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_TWO,
    );
    const baseGraphResponse = await client.getFederatedGraphByName({
      name: baseGraphName,
      namespace,
    });

    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);
    // Two subgraph publishes for two compositions
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const contractName = genID('contractName');
    const createContractResponse = await client.createContract({
      name: contractName,
      namespace,
      sourceGraphName: baseGraphName,
      excludeTags: ['dev-only'],
      routingUrl: 'http://localhost:3004',
    });
    expect(createContractResponse.response?.code).toBe(EnumStatusCode.OK);

    const contractResponse = await client.getFederatedGraphByName({
      name: contractName,
      namespace,
    });

    // There should be two keys in storage (source graph and contract)
    expect(blobStorage.keys()).toHaveLength(2);
    const contractKey = blobStorage.keys()[1];
    expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);

    // There should be a composition for the contract
    await assertNumberOfCompositions(client, contractName, 1, namespace);
    // The source graph compositions should remain at two
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const rawExecutionConfig = await blobStorage.getObject({ key: contractKey });
    expect(rawExecutionConfig).toBeDefined();

    const executionConfig: RouterConfig = await rawExecutionConfig.stream
      .getReader()
      .read()
      .then((result) => JSON.parse(result.value.toString()));

    expect(executionConfig.engineConfig).toBeDefined();
    expect(executionConfig.engineConfig?.graphqlSchema).toBeDefined();
    expect(executionConfig.engineConfig?.graphqlClientSchema).toBeDefined();
    expect(normalizeString(executionConfig.engineConfig!.graphqlSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      
      type Query {
        internalUser(id: ID!): InternalUser! @tag(name: "dev-only") @inaccessible
        user(id: ID!): User!
        internalProduct(sku: ID!): InternalProduct! @tag(name: "dev-only") @inaccessible
        product(sku: ID!): User!
      }

      type Mutation {
        internalUpdateUser(id: ID!): InternalUser! @tag(name: "dev-only") @inaccessible
        updateUser(id: ID!): User!
      }

      type User {
        id: ID!
        name: String!
        age: Int!
        preferredProduct: Product!
      }

      type InternalUser @tag(name: "dev-only") @inaccessible {
        id: ID!
        user: User!
        privateField: String!
        preferredProduct: Product!
      }

      type Product {
        sku: ID!
        name: String!
      }

      type InternalProduct @tag(name: "dev-only") @inaccessible {
        sku: ID!
        product: Product!
        stock: Int!
      }
    `),
    );
    expect(normalizeString(executionConfig.engineConfig!.graphqlClientSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      
      type Query {
        user(id: ID!): User!
        product(sku: ID!): User!
      }

      type Mutation {
        updateUser(id: ID!): User!
      }

      type User {
        id: ID!
        name: String!
        age: Int!
        preferredProduct: Product!
      }

      type Product {
        sku: ID!
        name: String!
      }
    `),
    );

    const publishSubgraphResponse = await client.publishFederatedSubgraph({
      name: 'products',
      namespace,
      schema: fs.readFileSync(join(process.cwd(), `test/test-data/contracts/products-v2.graphql`)).toString(),
    });
    expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // There should be a new source graph composition
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
    // There should be a new contract composition
    await assertNumberOfCompositions(client, contractName, 2, namespace);

    // There should still be only two keys
    expect(blobStorage.keys()).toHaveLength(2);

    const newRawExecutionConfig = await blobStorage.getObject({ key: contractKey });
    expect(newRawExecutionConfig).toBeDefined();

    const newExecutionConfig: RouterConfig = await newRawExecutionConfig.stream
      .getReader()
      .read()
      .then((result) => JSON.parse(result.value.toString()));

    expect(newExecutionConfig.engineConfig).toBeDefined();
    expect(newExecutionConfig.engineConfig?.graphqlSchema).toBeDefined();
    expect(newExecutionConfig.engineConfig?.graphqlClientSchema).toBeDefined();
    expect(normalizeString(newExecutionConfig.engineConfig!.graphqlSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      
      type Query {
        internalUser(id: ID!): InternalUser! @tag(name: "dev-only") @inaccessible
        user(id: ID!): User!
        internalProduct(sku: ID!): InternalProduct! @tag(name: "dev-only") @inaccessible
        product(sku: ID!): User!
      }

      type Mutation {
        internalUpdateUser(id: ID!): InternalUser! @tag(name: "dev-only") @inaccessible
        updateUser(id: ID!): User!
      }

      type User {
        id: ID!
        name: String!
        age: Int!
        preferredProduct: Product!
      }

      type InternalUser @tag(name: "dev-only") @inaccessible {
        id: ID!
        user: User!
        privateField: String!
        preferredProduct: Product!
      }

      type Product {
        sku: ID!
        upc: Int!
        name: String!
      }

      type InternalProduct @tag(name: "dev-only") @inaccessible {
        sku: ID!
        product: Product!
        stock: Int!
      }
    `),
    );
    expect(normalizeString(newExecutionConfig.engineConfig!.graphqlClientSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      
      type Query {
        user(id: ID!): User!
        product(sku: ID!): User!
      }

      type Mutation {
        updateUser(id: ID!): User!
      }

      type User {
        id: ID!
        name: String!
        age: Int!
        preferredProduct: Product!
      }

      type Product {
        sku: ID!
        upc: Int!
        name: String!
      }
    `),
    );

    await server.close();
  });

  test('that a contract with include tags uploads the correct client schema to the router', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname, chClient });

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);
    const baseGraphName = genID('baseGraphName');
    const label = genUniqueLabel('label');
    const labels = [label];
    await createFederatedGraph(client, baseGraphName, namespace, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/contracts/users-include.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createAndPublishSubgraph(
      client,
      'products',
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/contracts/products-include.graphql`)).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_TWO,
    );
    const baseGraphResponse = await client.getFederatedGraphByName({
      name: baseGraphName,
      namespace,
    });

    expect(blobStorage.keys()).toHaveLength(1);
    const baseGraphKey = blobStorage.keys()[0];
    expect(baseGraphKey).toContain(`${baseGraphResponse.graph!.id}/routerconfigs/latest.json`);
    await assertFeatureFlagExecutionConfig(blobStorage, baseGraphKey, false);
    // Two subgraph publishes for two compositions
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const contractName = genID('contractName');
    const createContractResponse = await client.createContract({
      name: contractName,
      namespace,
      sourceGraphName: baseGraphName,
      includeTags: ['dev-only'],
      routingUrl: 'http://localhost:3004',
    });
    expect(createContractResponse.response?.code).toBe(EnumStatusCode.OK);

    const contractResponse = await client.getFederatedGraphByName({
      name: contractName,
      namespace,
    });

    // There should be two keys in storage (source graph and contract)
    expect(blobStorage.keys()).toHaveLength(2);
    const contractKey = blobStorage.keys()[1];
    expect(contractKey).toContain(`${contractResponse.graph!.id}/routerconfigs/latest.json`);

    // There should be a composition for the contract
    await assertNumberOfCompositions(client, contractName, 1, namespace);
    // The source graph compositions should remain at two
    await assertNumberOfCompositions(client, baseGraphName, 2, namespace);

    const rawExecutionConfig = await blobStorage.getObject({ key: contractKey });
    expect(rawExecutionConfig).toBeDefined();

    const executionConfig: RouterConfig = await rawExecutionConfig.stream
      .getReader()
      .read()
      .then((result) => JSON.parse(result.value.toString()));

    expect(executionConfig.engineConfig).toBeDefined();
    expect(executionConfig.engineConfig?.graphqlSchema).toBeDefined();
    expect(executionConfig.engineConfig?.graphqlClientSchema).toBeDefined();
    expect(normalizeString(executionConfig.engineConfig!.graphqlSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

      scalar openfed__Scope
      
      type Query {
        internalUser(id: ID!): InternalUser! @tag(name: "dev-only")
        user(id: ID!): User! @inaccessible
        internalProduct(sku: ID!): InternalProduct! @tag(name: "dev-only")
        product(sku: ID!): User! @inaccessible
      }

      type Mutation {
        internalUpdateUser(id: ID!): InternalUser! @tag(name: "dev-only")
        updateUser(id: ID!): User! @inaccessible
      }

      type User @inaccessible {
        id: ID!
        name: String!
        age: Int!
        preferredProduct: Product!
      }

      type InternalUser @tag(name: "dev-only") {
        id: ID!
        privateField: String!
        preferredProduct: Product! @inaccessible
      }

      type Product @inaccessible {
        sku: ID!
        name: String!
      }

      type InternalProduct @tag(name: "dev-only") {
        sku: ID!
        product: Product! @inaccessible
        stock: Int!
      }
    `),
    );
    expect(normalizeString(executionConfig.engineConfig!.graphqlClientSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      
      type Query {
        internalUser(id: ID!): InternalUser!
        internalProduct(sku: ID!): InternalProduct!
      }

      type Mutation {
        internalUpdateUser(id: ID!): InternalUser!
      }

      type InternalUser {
        id: ID!
        privateField: String!
      }
      
      type InternalProduct {
        sku: ID!
        stock: Int!
      }
    `),
    );

    const publishSubgraphResponse = await client.publishFederatedSubgraph({
      name: 'products',
      namespace,
      schema: fs.readFileSync(join(process.cwd(), `test/test-data/contracts/products-v2-includes.graphql`)).toString(),
    });
    expect(publishSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // There should be a new source graph composition
    await assertNumberOfCompositions(client, baseGraphName, 3, namespace);
    // There should be a new contract composition
    await assertNumberOfCompositions(client, contractName, 2, namespace);

    // There should still be only two keys
    expect(blobStorage.keys()).toHaveLength(2);

    const newRawExecutionConfig = await blobStorage.getObject({ key: contractKey });
    expect(newRawExecutionConfig).toBeDefined();

    const newExecutionConfig: RouterConfig = await newRawExecutionConfig.stream
      .getReader()
      .read()
      .then((result) => JSON.parse(result.value.toString()));

    expect(newExecutionConfig.engineConfig).toBeDefined();
    expect(newExecutionConfig.engineConfig?.graphqlSchema).toBeDefined();
    expect(newExecutionConfig.engineConfig?.graphqlClientSchema).toBeDefined();
    expect(normalizeString(newExecutionConfig.engineConfig!.graphqlSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      
      directive @authenticated on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @inaccessible on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION
      directive @requiresScopes(scopes: [[openfed__Scope!]!]!) on ENUM | FIELD_DEFINITION | INTERFACE | OBJECT | SCALAR
      directive @tag(name: String!) repeatable on ARGUMENT_DEFINITION | ENUM | ENUM_VALUE | FIELD_DEFINITION | INPUT_FIELD_DEFINITION | INPUT_OBJECT | INTERFACE | OBJECT | SCALAR | UNION

      scalar openfed__Scope
      
      type Query {
        internalUser(id: ID!): InternalUser! @tag(name: "dev-only")
        user(id: ID!): User! @inaccessible
        internalProduct(sku: ID!): InternalProduct! @tag(name: "dev-only")
        product(sku: ID!): User! @inaccessible
      }

      type Mutation {
        internalUpdateUser(id: ID!): InternalUser! @tag(name: "dev-only")
        updateUser(id: ID!): User! @inaccessible
      }

      type User @inaccessible {
        id: ID!
        name: String!
        age: Int!
        preferredProduct: Product!
      }

      type InternalUser @tag(name: "dev-only") {
        id: ID!
        privateField: String!
        preferredProduct: Product! @inaccessible
      }

      type Product @inaccessible {
        sku: ID!
        upc: Int!
        name: String!
      }

      type InternalProduct @tag(name: "dev-only") {
        sku: ID!
        product: Product! @inaccessible
        stock: Int!
      }
    `),
    );
    expect(normalizeString(newExecutionConfig.engineConfig!.graphqlClientSchema!)).toBe(
      normalizeString(`
      schema {
        query: Query
        mutation: Mutation
      }
      
      type Query {
        internalUser(id: ID!): InternalUser!
        internalProduct(sku: ID!): InternalProduct!
      }

      type Mutation {
        internalUpdateUser(id: ID!): InternalUser!
      }

      type InternalUser {
        id: ID!
        privateField: String!
      }

      type InternalProduct {
        sku: ID!
        stock: Int!
      }
    `),
    );

    await server.close();
  });
});
