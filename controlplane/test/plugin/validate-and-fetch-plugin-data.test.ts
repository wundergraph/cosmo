import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { SubgraphType } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestRBACEvaluator,
  createTestGroup,
  genID,
  genUniqueLabel,
  TestUser,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';
import { OrganizationRole } from '../../src/db/models.js';
import { audiences } from '../../src/core/crypto/jwt.js';

// Read the actual proto, mapping and lock files
const testDataPath = path.join(process.cwd(), 'test/test-data/plugin');
const pluginSchema = readFileSync(path.join(testDataPath, 'service.proto'), 'utf8');
const pluginMappings = readFileSync(path.join(testDataPath, 'mapping.json'), 'utf8');
const pluginLock = readFileSync(path.join(testDataPath, 'service.proto.lock.json'), 'utf8');

let dbname = '';

describe('ValidateAndFetchPluginData', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should successfully validate and fetch plugin data for new plugin', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' }, // Plan that allows plugins
    });

    const pluginName = genID('plugin');
    const label = genUniqueLabel('test');

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v1'); // First version for new plugin
    expect(response.pushToken).toBeDefined();
    expect(response.pushToken.length).toBeGreaterThan(0);
    expect(response.reference).toBeDefined();
    expect(response.reference).toMatch(/^[\da-f-]+\/[\da-f-]+$/); // organizationId/subgraphId format

    await server.close();
  });

  test('Should increment version for existing plugin', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const label = genUniqueLabel('test');

    // First create the plugin subgraph
    const createResponse = await client.createFederatedSubgraph({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      type: SubgraphType.GRPC_PLUGIN,
    });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);

    // Publish the plugin to set version to v1
    const publishResponse = await client.publishFederatedSubgraph({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String! }',
      type: SubgraphType.GRPC_PLUGIN,
      proto: {
        schema: pluginSchema,
        mappings: pluginMappings,
        lock: pluginLock,
        version: 'v1',
        platforms: ['linux/amd64'],
      },
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    // Now validate and fetch plugin data - should increment version
    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v2'); // Should increment from v1 to v2
    expect(response.pushToken).toBeDefined();
    expect(response.reference).toBeDefined();

    await server.close();
  });

  test('Should fail when namespace does not exist', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const nonExistentNamespace = genID('nonexistent');

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: nonExistentNamespace,
      labels: [],
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toBe(`Could not find namespace ${nonExistentNamespace}`);
    expect(response.newVersion).toBe('');
    expect(response.pushToken).toBe('');
    expect(response.reference).toBe('');

    await server.close();
  });

  test('Should fail when plugin limit is reached', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'developer@1' }, // Developer plan has 0 plugin limit
    });

    // Create 3 plugins successfully
    for (let i = 1; i <= 3; i++) {
      const pluginName = genID(`plugin-${i}`);
      const pluginLabel = genUniqueLabel(`team-${i}`);

      const createPluginSubgraphResp = await client.createFederatedSubgraph({
        name: pluginName,
        namespace: DEFAULT_NAMESPACE,
        type: SubgraphType.GRPC_PLUGIN,
        labels: [pluginLabel],
      });

      expect(createPluginSubgraphResp.response?.code).toBe(EnumStatusCode.OK);
    }

    const fourthPluginName = genID('plugin-4');
    const fourthPluginLabel = genUniqueLabel('team-4');

    const response = await client.validateAndFetchPluginData({
      name: fourthPluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [fourthPluginLabel],
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_LIMIT_REACHED);
    expect(response.response?.details).toBe('The organization reached the limit of plugins');
    expect(response.newVersion).toBe('');
    expect(response.pushToken).toBe('');
    expect(response.reference).toBe('');

    await server.close();
  });

  test('Should fail with invalid plugin name', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const invalidPluginName = ''; // Empty name is invalid
    const label = genUniqueLabel('test');

    const response = await client.validateAndFetchPluginData({
      name: invalidPluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_INVALID_NAME);
    expect(response.response?.details).toBe(
      "The name of the subgraph is invalid. Name should start and end with an alphanumeric character. Only '.', '_', '@', '/', and '-' are allowed as separators in between and must be between 1 and 100 characters in length.",
    );
    expect(response.newVersion).toBe('');
    expect(response.pushToken).toBe('');
    expect(response.reference).toBe('');

    await server.close();
  });

  test('Should fail with invalid labels', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const invalidLabel = { key: '', value: 'test' }; // Empty key is invalid

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [invalidLabel],
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_INVALID_LABELS);
    expect(response.response?.details).toBe('One or more labels were found to be invalid');
    expect(response.newVersion).toBe('');
    expect(response.pushToken).toBe('');
    expect(response.reference).toBe('');

    await server.close();
  });

  test('Should work with existing plugin subgraph', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const label = genUniqueLabel('test');

    // First create the plugin subgraph
    const createResponse = await client.createFederatedSubgraph({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      type: SubgraphType.GRPC_PLUGIN,
    });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);

    // Now validate and fetch plugin data for existing plugin
    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v1'); // Default version for plugin without published version
    expect(response.pushToken).toBeDefined();
    expect(response.reference).toBeDefined();

    await server.close();
  });

  test('Should generate valid JWT push token with correct payload', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const label = genUniqueLabel('test');

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.pushToken).toBeDefined();

    // JWT should have 3 parts separated by dots
    const jwtParts = response.pushToken.split('.');
    expect(jwtParts).toHaveLength(3);

    // Decode the payload (second part) to verify structure
    const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString());
    expect(payload.iss).toBeDefined(); // issuer (user ID)
    expect(payload.aud).toBe(audiences.cosmoPluginKey); // audience
    expect(payload.exp).toBeDefined(); // expiration
    expect(payload.access).toBeDefined();
    expect(payload.access).toHaveLength(1);
    expect(payload.access[0].type).toBe('repository');
    expect(payload.access[0].name).toBe(response.reference);
    expect(payload.access[0].tag).toBe(response.newVersion);
    expect(payload.access[0].actions).toEqual(['push', 'pull']);

    await server.close();
  });

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin'])(
    '%s should be able to validate and fetch plugin data',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({
        dbname,
        enableMultiUsers: true,
        enabledFeatures: ['rbac'],
        setupBilling: { plan: 'launch@1' },
      });

      const pluginName = genID('plugin');
      const label = genUniqueLabel('test');

      authenticator.changeUserWithSuppliedContext({
        ...users[TestUser.adminAliceCompanyA],
        rbac: createTestRBACEvaluator(createTestGroup({ role: role as OrganizationRole })),
      });

      const response = await client.validateAndFetchPluginData({
        name: pluginName,
        namespace: DEFAULT_NAMESPACE,
        labels: [label],
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
      expect(response.newVersion).toBe('v1');
      expect(response.pushToken).toBeDefined();
      expect(response.reference).toBeDefined();

      await server.close();
    },
  );

  test('Should fail when user has insufficient permissions', async () => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      enabledFeatures: ['rbac'],
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const label = genUniqueLabel('test');

    // Use a viewer role which shouldn't be able to create plugins
    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-viewer' })),
    });

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    await server.close();
  });

  test('Should handle complex plugin names with valid separators', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const complexPluginName = 'org.service-name@v1/plugin_test.example';
    const label = genUniqueLabel('test');

    const response = await client.validateAndFetchPluginData({
      name: complexPluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v1');
    expect(response.pushToken).toBeDefined();
    expect(response.reference).toBeDefined();

    await server.close();
  });

  test('Should handle multiple labels correctly', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const labels = [genUniqueLabel('env'), genUniqueLabel('team'), genUniqueLabel('version')];

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v1');
    expect(response.pushToken).toBeDefined();
    expect(response.reference).toBeDefined();

    await server.close();
  });

  test('Should work with empty labels array', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [], // Empty labels should be allowed
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v1');
    expect(response.pushToken).toBeDefined();
    expect(response.reference).toBeDefined();

    await server.close();
  });

  test('Should handle high version numbers correctly', async () => {
    const { client, server } = await SetupTest({
      dbname,
      setupBilling: { plan: 'launch@1' },
    });

    const pluginName = genID('plugin');
    const label = genUniqueLabel('test');

    // Create plugin and simulate high version number by publishing multiple times
    const createResponse = await client.createFederatedSubgraph({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      type: SubgraphType.GRPC_PLUGIN,
    });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);

    // Simulate plugin at version v99
    const publishResponse = await client.publishFederatedSubgraph({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String! }',
      type: SubgraphType.GRPC_PLUGIN,
      proto: {
        schema: pluginSchema,
        mappings: pluginMappings,
        lock: pluginLock,
        version: 'v99',
        platforms: ['linux/amd64'],
      },
    });
    expect(publishResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.validateAndFetchPluginData({
      name: pluginName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.newVersion).toBe('v100'); // Should increment to v100
    expect(response.pushToken).toBeDefined();
    expect(response.reference).toBeDefined();

    await server.close();
  });
});
