import type { UUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SetupTest } from '../test-util.js';
import { afterAllSetup, beforeAllSetup, createTestContext, genID } from '../../src/core/test-util.js';
import { OrganizationRepository } from '../../src/core/repositories/OrganizationRepository.js';

describe('Default plan features of a new organization', () => {
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('an organization created under the enterprise default plan has the enterprise features as its own', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, billingDefaultPlanId: 'enterprise' });
    testContext.onTestFinished(() => server.close());

    const slug = genID('org');
    const createResponse = await client.createOrganization({ name: slug, slug, plan: 'enterprise' });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);
    const organizationId = createResponse.organization!.id as UUID;

    // Feature checks that never fall back to the default plan, as most handlers construct the repository.
    const orgRepo = new OrganizationRepository(server.log, server.db);
    expect(await orgRepo.isFeatureEnabled(organizationId, 'rbac')).toBe(true);
    expect(await orgRepo.getFeature({ organizationId, featureId: 'proposals' })).toEqual({
      id: 'proposals',
      enabled: true,
      limit: null,
    });
    expect(await orgRepo.getFeature({ organizationId, featureId: 'federated-graphs' })).toEqual({
      id: 'federated-graphs',
      enabled: true,
      limit: 25,
    });
    expect(await orgRepo.getFeature({ organizationId, featureId: 'users' })).toEqual({
      id: 'users',
      enabled: true,
      limit: 1000,
    });

    authenticator.changeUserWithSuppliedContext(createTestContext(slug, organizationId));
    const groupResponse = await client.createOrganizationGroup({ name: 'reviewers', description: '' });
    expect(groupResponse.response?.code).toBe(EnumStatusCode.OK);

    const proposalsResponse = await client.enableProposalsForNamespace({
      namespace: 'default',
      enableProposals: true,
    });
    expect(proposalsResponse.response?.code).toBe(EnumStatusCode.OK);
  });

  test('an organization created without a default plan has no RBAC', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const slug = genID('org');
    const createResponse = await client.createOrganization({ name: slug, slug, plan: 'developer' });
    expect(createResponse.response?.code).toBe(EnumStatusCode.OK);
    const organizationId = createResponse.organization!.id as UUID;

    authenticator.changeUserWithSuppliedContext(createTestContext(slug, organizationId));
    const groupResponse = await client.createOrganizationGroup({ name: 'reviewers', description: '' });
    expect(groupResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
  });
});
