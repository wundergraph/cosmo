import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { Feature } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';
import { afterAllSetup, beforeAllSetup, createTestGroup, createTestRBACEvaluator } from '../../src/core/test-util.js';
import { SetupTest } from '../test-util.js';

let dbname = '';

describe('UpdateFeatureSettings', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should enable the rbac feature', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const response = await client.updateFeatureSettings({
      featureId: Feature.rbac,
      enable: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const feature = await orgRepo.getFeature({
      organizationId: users.adminAliceCompanyA.organizationId,
      featureId: 'rbac',
    });
    expect(feature?.enabled).toBe(true);
  });

  test('Should disable the rbac feature', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    const response = await client.updateFeatureSettings({
      featureId: Feature.rbac,
      enable: false,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const feature = await orgRepo.getFeature({
      organizationId: users.adminAliceCompanyA.organizationId,
      featureId: 'rbac',
    });
    expect(feature?.enabled).toBe(false);
  });

  test('Should enable the ai feature', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['ai'] });
    testContext.onTestFinished(() => server.close());

    const response = await client.updateFeatureSettings({
      featureId: Feature.ai,
      enable: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const feature = await orgRepo.getFeature({
      organizationId: users.adminAliceCompanyA.organizationId,
      featureId: 'ai',
    });
    expect(feature?.enabled).toBe(true);
  });

  test('Should enable the scim feature', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['scim'] });
    testContext.onTestFinished(() => server.close());

    const response = await client.updateFeatureSettings({
      featureId: Feature.scim,
      enable: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    const feature = await orgRepo.getFeature({
      organizationId: users.adminAliceCompanyA.organizationId,
      featureId: 'scim',
    });
    expect(feature?.enabled).toBe(true);
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
  ])('%s (non-admin) should NOT be able to update feature settings', async (role) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role })),
    });

    const response = await client.updateFeatureSettings({
      featureId: Feature.rbac,
      enable: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });

  test('organization-admin should be able to update feature settings', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, enabledFeatures: ['rbac'] });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createTestRBACEvaluator(createTestGroup({ role: 'organization-admin' })),
    });

    const response = await client.updateFeatureSettings({
      featureId: Feature.rbac,
      enable: true,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });
});
