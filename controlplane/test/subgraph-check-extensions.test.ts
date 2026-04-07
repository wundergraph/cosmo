import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, onTestFinished, test, vi } from 'vitest';
import { joinLabel } from '@wundergraph/cosmo-shared';
import axios from 'axios';
import { TestUser, afterAllSetup, beforeAllSetup, genUniqueLabel, genID } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

const subgraph1Schema = `
type Query {
  employees: [Employee!]!
}

type Employee {
  id: Int!
  name: String!
}
`;

const subgraph2Schema = `
type Query {
  departments: [Department!]!
}

type Department {
  id: Int!
  title: String!
}
`;

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

async function setupTestGraphs(postSpy: ReturnType<typeof vi.spyOn>) {
  const { client, server, users, blobStorage } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
  const response = await client.configureSubgraphCheckExtensions({
    enableSubgraphCheckExtensions: true,
    namespace: 'default',
    endpoint: 'https://example.com/handler',
  });

  expect(response.response?.code).toBe(EnumStatusCode.OK);

  const fedGraphName = genID('fedGraph');
  const subgraph1Name = genID('subgraph1');
  const subgraph2Name = genID('subgraph2');
  const label = genUniqueLabel();

  // Create a federated graph
  const createFedGraphRes = await client.createFederatedGraph({
    name: fedGraphName,
    namespace: 'default',
    routingUrl: 'http://localhost:8081',
    labelMatchers: [joinLabel(label)],
  });

  expect(createFedGraphRes.response?.code).toBe(EnumStatusCode.OK);

  // Create and publish first subgraph
  let resp = await client.createFederatedSubgraph({
    name: subgraph1Name,
    namespace: 'default',
    labels: [label],
    routingUrl: 'http://localhost:8082',
  });

  expect(resp.response?.code).toBe(EnumStatusCode.OK);

  resp = await client.publishFederatedSubgraph({
    name: subgraph1Name,
    namespace: 'default',
    schema: subgraph1Schema,
  });

  expect(resp.response?.code).toBe(EnumStatusCode.OK);

  // Create and publish second subgraph
  resp = await client.createFederatedSubgraph({
    name: subgraph2Name,
    namespace: 'default',
    labels: [label],
    routingUrl: 'http://localhost:8083',
  });

  expect(resp.response?.code).toBe(EnumStatusCode.OK);

  resp = await client.publishFederatedSubgraph({
    name: subgraph2Name,
    namespace: 'default',
    schema: subgraph2Schema,
  });

  expect(resp.response?.code).toBe(EnumStatusCode.OK);

  vi.spyOn(axios, 'create').mockReturnValue({
    post: postSpy,
    get: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  } as any);

  return {
    client,
    server,
    subgraph1Name,
    subgraph2Name,
    fedGraphName,
    adminAliceCompanyA: users.adminAliceCompanyA,
    blobStorage,
  };
}

describe('Subgraph Check Extensions Tests', (ctx) => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should enable subgraph check extensions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });

  test('Should not be able to enable subgraph check extensions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'launch@1' } });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(response.response?.details).toBe('Upgrade to enterprise plan to enable subgraph check extensions');
  });

  test('users without write access should not be able to enable subgraph check extensions', async (testContext) => {
    const { client, authenticator, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enableMultiUsers: true,
    });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(response.response?.details).toBe('The user does not have the permissions to perform this operation');
  });

  test('should configure subgraph check extensions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    let getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual('http://localhost:4000/');
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(false);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(true);

    const configureGraphPruningConfigResponse = await client.configureSubgraphCheckExtensions({
      namespace: 'default',
      enableSubgraphCheckExtensions: true,
      endpoint: 'http://localhost:4000/',
      secretKey: '...',
      includeComposedSdl: false,
    });

    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);
    getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual('http://localhost:4000/');
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(true);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(false);
  });

  test('users without write access should not be able to configure subgraph check extensions', async (testContext) => {
    const { client, authenticator, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enableMultiUsers: true,
    });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual('http://localhost:4000/');
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(false);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(true);

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    const configureGraphPruningConfigResponse = await client.configureSubgraphCheckExtensions({
      namespace: 'default',
      endpoint: 'http://localhost:5000/',
      secretKey: '...',
      includeComposedSdl: false,
    });

    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(configureGraphPruningConfigResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );
  });

  test.each(['http', 'https'])('that `%s://localhost` is allowed as the endpoint', async (protocol) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: `${protocol}://localhost:4000/`,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    let getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual(`${protocol}://localhost:4000/`);
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(false);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(true);

    const configureGraphPruningConfigResponse = await client.configureSubgraphCheckExtensions({
      namespace: 'default',
      enableSubgraphCheckExtensions: true,
      endpoint: `${protocol}://localhost:5000/`,
      secretKey: '...',
      includeComposedSdl: false,
    });

    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);
    getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual(`${protocol}://localhost:5000/`);
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(true);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(false);
  });

  test('that an endpoint with invalid schema is not saved', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'ws://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('The endpoint must be a valid absolute URL starting with https://');
  });

  test('that https is required when not using localhost', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://example.com/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('The endpoint must be a valid absolute URL starting with https://');
  });

  test('that an endpoint with https is updated successfully', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    testContext.onTestFinished(() => server.close());

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'https://example.com/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    let getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual('https://example.com/');
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(false);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(true);

    const configureGraphPruningConfigResponse = await client.configureSubgraphCheckExtensions({
      namespace: 'default',
      enableSubgraphCheckExtensions: true,
      endpoint: 'https://example.com/handler',
      secretKey: '...',
      includeComposedSdl: false,
    });

    expect(configureGraphPruningConfigResponse.response?.code).toBe(EnumStatusCode.OK);
    getSubgraphCheckExtensionsConfig = await client.getSubgraphCheckExtensionsConfig({
      namespace: 'default',
    });

    expect(getSubgraphCheckExtensionsConfig.response?.code).toBe(EnumStatusCode.OK);
    expect(getSubgraphCheckExtensionsConfig.isEnabledForNamespace).toBe(true);
    expect(getSubgraphCheckExtensionsConfig.endpoint).toStrictEqual('https://example.com/handler');
    expect(getSubgraphCheckExtensionsConfig.isSecretKeyAssigned).toStrictEqual(true);
    expect(getSubgraphCheckExtensionsConfig.includeComposedSdl).toStrictEqual(false);
  });

  test('that the subgraph check extension webhook is sent and handled correctly', async (testContext) => {
    const postSpy = vi.fn().mockResolvedValue({ status: 400, data: {} });

    const { client, server, subgraph1Name, fedGraphName, adminAliceCompanyA, blobStorage } =
      await setupTestGraphs(postSpy);
    testContext.onTestFinished(() => server.close());

    // Run the schema check
    const checkResp = await client.checkSubgraphSchema({
      subgraphName: subgraph1Name,
      schema: new Uint8Array(Buffer.from(subgraph1Schema)),
      namespace: 'default',
    });

    expect(checkResp.response?.code).toBe(EnumStatusCode.OK);
    expect(checkResp.checkExtensionErrorMessage).toBe(
      "Check extension returned status code '400'. Allowed values are 200 and 204.",
    );

    // Verify that the configured endpoint was hit
    expect(postSpy).toHaveBeenCalledOnce();

    const [url, data] = postSpy.mock.calls[0];

    expect(url).toBe('https://example.com/handler');
    expect(data.actorId).toBe(adminAliceCompanyA.userId);
    expect(data.checkId).toBe(checkResp.checkId);
    expect(data.url).toBeDefined();
    expect(data.url).not.toBeNull();

    // Read the content of the uploaded file from the provided url
    const payloadUrl = new URL(data.url);
    const blob = await blobStorage.getObject({ key: payloadUrl.pathname.slice(1) });
    expect(blob?.stream).toBeDefined();

    const reader = blob.stream.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(value);
    }

    const text = Buffer.concat(chunks).toString('utf8');
    const json = JSON.parse(text);

    expect(json.subgraphs).toHaveLength(1);
    expect(json.subgraphs[0]?.name).toBe(subgraph1Name);

    // Verify that the subgraph check failure is recorded
    const checkSummary = await client.getCheckSummary({
      namespace: 'default',
      graphName: fedGraphName,
      checkId: checkResp.checkId,
    });

    expect(checkSummary.response?.code).toBe(EnumStatusCode.OK);
    expect(checkSummary.check?.checkExtensionErrorMessage).toBe(
      "Check extension returned status code '400'. Allowed values are 200 and 204.",
    );
  });
});
