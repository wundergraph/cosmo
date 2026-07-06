import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, createTestGroup, createTestRBACEvaluator } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('GetUserAccessiblePermissions', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('organization-admin should get accessible permissions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getUserAccessiblePermissions({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(Array.isArray(response.permissions)).toBe(true);
  });

  test('organization-admin with scim enabled should get the scim permission', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['scim'] });
    testContext.onTestFinished(() => server.close());

    const response = await client.getUserAccessiblePermissions({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const scimPermission = response.permissions.find((p) => p.value === 'scim');
    expect(scimPermission?.value).toBe('scim');
  });

  test('organization-admin without scim should NOT get the scim permission', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getUserAccessiblePermissions({});

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    const scimPermission = response.permissions.find((p) => p.value === 'scim');
    expect(scimPermission).toBe(undefined);
  });

  test.each([
    'organization-developer',
    'organization-viewer',
    'organization-apikey-manager',
    'namespace-admin',
    'namespace-viewer',
    'graph-admin',
    'graph-viewer',
    'subgraph-admin',
    'subgraph-publisher',
    'subgraph-viewer',
  ])('%s (non-admin) should return empty permissions', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, enabledFeatures: ['scim'] });
    onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const response = await client.getUserAccessiblePermissions({});

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });
});
