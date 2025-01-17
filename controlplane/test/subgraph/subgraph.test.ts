import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

describe('Subgraph', (ctx) => {
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

  test('Should be able to create a subgraph and publish the schema', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();

    let resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    resp = await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      schema: 'type Query { hello: String! }',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should create a subgraph when subgraph did not exist before on publish', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const pandasSchemaBuffer = await readFile(join(process.cwd(), 'test/graphql/federationV1/pandas.graphql'));
    const pandasSchema = new TextDecoder().decode(pandasSchemaBuffer);

    const federatedGraphName = genID('fedGraph');
    const label = genUniqueLabel();

    const createFederatedGraphResp = await client.createFederatedGraph({
      name: federatedGraphName,
      namespace: 'default',
      labelMatchers: [joinLabel(label)],
      routingUrl: 'http://localhost:8081',
    });
    expect(createFederatedGraphResp.response?.code).toBe(EnumStatusCode.OK);

    const publishResp = await client.publishFederatedSubgraph({
      name: 'pandas',
      namespace: 'default',
      schema: pandasSchema,
      labels: [label],
      routingUrl: 'http://localhost:3000',
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const graph = await client.getFederatedGraphByName({
      name: federatedGraphName,
      namespace: 'default',
    });
    expect(graph.response?.code).toBe(EnumStatusCode.OK);

    expect(graph.graph?.isComposable).toBe(true);
    expect(graph.graph?.compositionErrors).toBe('');
    expect(graph.subgraphs.length).toBe(1);
    expect(graph.subgraphs[0].name).toBe('pandas');

    await server.close();
  });

  test('Should be able to create a subgraph with a readme', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();
    const readme = `# ${subgraphName}`;

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
      readme,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const subgraph = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });

    expect(subgraph.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraph.graph?.readme).toBe(readme);
    expect(subgraph.graph?.routingURL).toBe('http://localhost:8080');
    expect(subgraph.graph?.labels).toEqual([label]);

    await server.close();
  });

  test('Should be able to create a subgraph with a readme and update it later.', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph1');
    const label = genUniqueLabel();
    const readme = `# ${subgraphName}`;
    const updatedReadme = `# ${subgraphName} test`;

    const resp = await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: 'default',
      labels: [label],
      routingUrl: 'http://localhost:8080',
      readme,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    const updateResponse = await client.updateSubgraph({
      name: subgraphName,
      namespace: 'default',
      readme: updatedReadme,
    });

    expect(updateResponse.response?.code).toBe(EnumStatusCode.OK);

    const subgraph = await client.getSubgraphByName({
      name: subgraphName,
      namespace: 'default',
    });

    expect(subgraph.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraph.graph?.readme).toBe(updatedReadme);
    expect(subgraph.graph?.routingURL).toBe('http://localhost:8080');
    expect(subgraph.graph?.labels).toEqual([label]);

    await server.close();
  });
});
