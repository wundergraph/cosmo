import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createFederatedGraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Batch create subgraphs tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that multiple subgraphs can be created in one request', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphOne = genID('subgraphOne');
    const subgraphTwo = genID('subgraphTwo');

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphOne, routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [] },
        { name: subgraphTwo, routingUrl: DEFAULT_SUBGRAPH_URL_TWO, labels: [] },
      ],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.OK);
    expect(createResp.createdSubgraphNames).toEqual([subgraphOne, subgraphTwo]);

    const subgraphOneResp = await client.getSubgraphByName({ name: subgraphOne, namespace: DEFAULT_NAMESPACE });
    expect(subgraphOneResp.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphOneResp.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_ONE);

    const subgraphTwoResp = await client.getSubgraphByName({ name: subgraphTwo, namespace: DEFAULT_NAMESPACE });
    expect(subgraphTwoResp.response?.code).toBe(EnumStatusCode.OK);
    expect(subgraphTwoResp.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
  });

  test('that created subgraphs are attached to a federated graph with matching labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel('team');
    const fedGraphName = genID('fedGraph');
    const subgraphOne = genID('subgraphOne');
    const subgraphTwo = genID('subgraphTwo');

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphOne, routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [label] },
        { name: subgraphTwo, routingUrl: DEFAULT_SUBGRAPH_URL_TWO, labels: [label] },
      ],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const fedGraphResp = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });
    expect(fedGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(fedGraphResp.subgraphs.map((subgraph) => subgraph.name).sort()).toEqual([subgraphOne, subgraphTwo].sort());
  });

  test('that unlabelled subgraphs are attached to a federated graph without label matchers', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const fedGraphName = genID('fedGraph');
    const subgraphOne = genID('subgraphOne');
    const subgraphTwo = genID('subgraphTwo');

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [], DEFAULT_ROUTER_URL);

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphOne, routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [] },
        { name: subgraphTwo, routingUrl: DEFAULT_SUBGRAPH_URL_TWO, labels: [] },
      ],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.OK);

    const fedGraphResp = await client.getFederatedGraphByName({ name: fedGraphName, namespace: DEFAULT_NAMESPACE });
    expect(fedGraphResp.response?.code).toBe(EnumStatusCode.OK);
    expect(fedGraphResp.subgraphs.map((subgraph) => subgraph.name).sort()).toEqual([subgraphOne, subgraphTwo].sort());
  });

  test('that an Event-Driven subgraph can be created without a routing URL', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [{ name: subgraphName, isEventDrivenGraph: true, labels: [] }],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.OK);
    expect(createResp.createdSubgraphNames).toEqual([subgraphName]);
  });

  test('that a duplicate name within the request is rejected and nothing is created', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const otherSubgraphName = genID('otherSubgraph');

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphName, routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [] },
        { name: otherSubgraphName, routingUrl: DEFAULT_SUBGRAPH_URL_TWO, labels: [] },
        { name: subgraphName, routingUrl: DEFAULT_SUBGRAPH_URL_TWO, labels: [] },
      ],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createResp.response?.details).toBe(`The following subgraphs were provided more than once: ${subgraphName}`);

    const otherSubgraphResp = await client.getSubgraphByName({
      name: otherSubgraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(otherSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('that an already existing subgraph rejects the whole batch', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const existingSubgraphName = genID('existingSubgraph');
    const newSubgraphName = genID('newSubgraph');

    const createExistingResp = await client.createFederatedSubgraph({
      name: existingSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: DEFAULT_SUBGRAPH_URL_ONE,
      labels: [],
    });
    expect(createExistingResp.response?.code).toBe(EnumStatusCode.OK);

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: newSubgraphName, routingUrl: DEFAULT_SUBGRAPH_URL_TWO, labels: [] },
        { name: existingSubgraphName, routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [] },
      ],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(createResp.response?.details).toBe(
      `The following subgraphs already exist in the namespace "${DEFAULT_NAMESPACE}": ${existingSubgraphName}`,
    );

    // The valid entry in the same request must not have been created.
    const newSubgraphResp = await client.getSubgraphByName({ name: newSubgraphName, namespace: DEFAULT_NAMESPACE });
    expect(newSubgraphResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('that a missing routing URL rejects the whole batch', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphWithUrl = genID('subgraphWithUrl');
    const subgraphWithoutUrl = genID('subgraphWithoutUrl');

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphWithUrl, routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [] },
        { name: subgraphWithoutUrl, labels: [] },
      ],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createResp.response?.details).toBe(
      `Subgraph "${subgraphWithoutUrl}": A non-Event-Driven Graph must define a routing URL`,
    );

    const subgraphWithUrlResp = await client.getSubgraphByName({
      name: subgraphWithUrl,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(subgraphWithUrlResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('that an invalid routing URL rejects the whole batch', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [{ name: subgraphName, routingUrl: 'not-a-url', labels: [] }],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createResp.response?.details).toBe(`Subgraph "${subgraphName}": Routing URL "not-a-url" is not a valid URL`);
  });

  test('that an empty request is rejected', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const createResp = await client.createFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createResp.response?.details).toBe('At least one subgraph must be provided.');
  });

  test('that creating subgraphs in an unknown namespace is rejected', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const createResp = await client.createFederatedSubgraphs({
      namespace: 'does-not-exist',
      subgraphs: [{ name: genID('subgraph'), routingUrl: DEFAULT_SUBGRAPH_URL_ONE, labels: [] }],
    });

    expect(createResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(createResp.response?.details).toBe('Could not find namespace does-not-exist');
  });
});
