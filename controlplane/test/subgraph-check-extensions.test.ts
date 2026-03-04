import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { TestUser, afterAllSetup, beforeAllSetup } from '../src/core/test-util.js';
import { SetupTest } from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

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
    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });

  test('Should not be able to enable subgraph check extensions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'launch@1' } });
    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(response.response?.details).toBe('Upgrade to enterprise plan to enable subgraph check extensions');

    await server.close();
  });

  test('users without write access should not be able to enable subgraph check extensions', async (testContext) => {
    const { client, authenticator, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enableMultiUsers: true,
    });

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(response.response?.details).toBe('The user does not have the permissions to perform this operation');

    await server.close();
  });

  test('should configure subgraph check extensions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
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

    await server.close();
  });

  test('users without write access should not be able to configure subgraph check extensions', async (testContext) => {
    const { client, authenticator, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'enterprise' },
      enableMultiUsers: true,
    });
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

    await server.close();
  });

  test.each(['http', 'https'])('that `%s://localhost` is allowed as the endpoint' , async (protocol) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
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

    await server.close();
  });

  test('that an endpoint with invalid schema is not saved' , async () => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'ws://localhost:4000/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('The endpoint must be a valid absolute URL starting with https://');

    await server.close();
  });

  test('that https is required when not using localhost' , async () => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
    const response = await client.configureSubgraphCheckExtensions({
      enableSubgraphCheckExtensions: true,
      namespace: 'default',
      endpoint: 'http://example.com/',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(response.response?.details).toBe('The endpoint must be a valid absolute URL starting with https://');

    await server.close();
  });

  test('that an endpoint with https is updated successfully' , async (protocol) => {
    const { client, server } = await SetupTest({ dbname, setupBilling: { plan: 'enterprise' } });
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

    await server.close();
  });
});