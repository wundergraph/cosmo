import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GroupMapperSchema } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAllSetup, beforeAllSetup, TestUser } from '../src/core/test-util.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
import * as schema from '../src/db/schema.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('OIDC provider', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create an OIDC provider ', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
    const providerId = provider.id;

    const getOIDCProviderResponse = await client.getOIDCProvider({ id: providerId });
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');
  });

  test('allows creating a second OIDC provider for the same organization', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const first = await client.createOIDCProvider({
      name: 'staging',
      clientID: 'staging-client',
      clientSecret: 'shh',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(first.response?.code).toBe(EnumStatusCode.OK);

    const second = await client.createOIDCProvider({
      name: 'production',
      clientID: 'prod-client',
      clientSecret: 'shh',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(second.response?.code).toBe(EnumStatusCode.OK);
  });

  test('Non admins should not be able to create an OIDC provider ', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUser(TestUser.devJoeCompanyA);

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    let createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(createOIDCProviderResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(createOIDCProviderResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );
  });

  test('Should be able to delete an OIDC provider ', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
    const providerId = provider.id;

    let getOIDCProviderResponse = await client.getOIDCProvider({ id: providerId });
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    const deleteOIDCProviderResponse = await client.deleteOIDCProvider({ id: providerId });
    expect(deleteOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    getOIDCProviderResponse = await client.getOIDCProvider({ id: providerId });
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('deleteOIDCProvider deletes only the specified provider', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const a = await client.createOIDCProvider({
      name: 'a',
      clientID: 'a',
      clientSecret: 's',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(a.response?.code).toBe(EnumStatusCode.OK);

    const b = await client.createOIDCProvider({
      name: 'b',
      clientID: 'b',
      clientSecret: 's',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(b.response?.code).toBe(EnumStatusCode.OK);

    const listed = await client.listOIDCProviders({});
    expect(listed.response?.code).toBe(EnumStatusCode.OK);
    const aId = listed.providers.find((p) => p.name === 'a')!.id;

    const deleteResponse = await client.deleteOIDCProvider({ id: aId });
    expect(deleteResponse.response?.code).toBe(EnumStatusCode.OK);

    const after = await client.listOIDCProviders({});
    expect(after.response?.code).toBe(EnumStatusCode.OK);
    expect(after.providers.map((p) => p.name)).toEqual(['b']);
  });

  test('Non admins should not be able to delete an OIDC provider ', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      enabledFeatures: ['oidc'],
    });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
    expect(provider.endpoint).toBe('localhost:8080');

    const getOIDCProviderResponse = await client.getOIDCProvider({ id: provider.id });
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    authenticator.changeUser(TestUser.devJoeCompanyA);

    let deleteOIDCProviderResponse = await client.deleteOIDCProvider({ id: provider.id });
    expect(deleteOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(deleteOIDCProviderResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    deleteOIDCProviderResponse = await client.deleteOIDCProvider({ id: provider.id });
    expect(deleteOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(deleteOIDCProviderResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );
  });

  test('Should be able to update mappers of an OIDC provider ', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
    const providerId = provider.id;

    let getOIDCProviderResponse = await client.getOIDCProvider({ id: providerId });
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    const updateMappersResponse = await client.updateIDPMappers({
      id: providerId,
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        create(GroupMapperSchema, {
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });
    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.OK);

    getOIDCProviderResponse = await client.getOIDCProvider({ id: providerId });
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(2);
  });

  test('Non admins should not be able to update mappers of an OIDC provider ', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      enabledFeatures: ['oidc'],
    });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
    expect(provider.endpoint).toBe('localhost:8080');

    const getOIDCProviderResponse = await client.getOIDCProvider({ id: provider.id });
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    authenticator.changeUser(TestUser.devJoeCompanyA);

    let updateMappersResponse = await client.updateIDPMappers({
      id: provider.id,
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        create(GroupMapperSchema, {
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });
    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(updateMappersResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    updateMappersResponse = await client.updateIDPMappers({
      id: provider.id,
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        create(GroupMapperSchema, {
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });
    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(updateMappersResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );
  });

  test('Should not be able to create an OIDC provider when the feature is not enabled', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });

    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(createOIDCProviderResponse.response?.details).toBe('OIDC feature is not enabled for this organization.');
  });

  test('Should not be able to update IDP mappers when the feature is not enabled', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    expect(provider.id).toBeTruthy();
    const providerId = provider.id;

    const orgRepo = new OrganizationRepository(server.log, server.db);
    await orgRepo.updateFeature({
      organizationId: users.adminAliceCompanyA.organizationId,
      id: 'oidc',
      enabled: false,
    });

    const updateMappersResponse = await client.updateIDPMappers({
      id: providerId,
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        create(GroupMapperSchema, {
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });

    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(updateMappersResponse.response?.details).toBe('OIDC feature is not enabled for this organization.');
  });

  test('lists multiple OIDC providers for an organization', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecret: 'secret',
      mappers: [
        create(GroupMapperSchema, {
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const organizationId = users.adminAliceCompanyA.organizationId;
    const organizationSlug = users.adminAliceCompanyA.organizationSlug;

    // Insert a second oidc_providers row directly to avoid the bufservice's
    // existing single-provider-per-org guard (removed in Task 4).
    await server.db
      .insert(schema.oidcProviders)
      .values({
        name: 'second',
        alias: `${organizationSlug}_xyz`,
        endpoint: 'second.example.com',
        organizationId,
      })
      .execute();

    const repo = new OidcRepository(server.db);
    const all = await repo.listOidcProvidersByOrganizationId({ organizationId });
    expect(all.length).toBe(2);

    const byAlias = await repo.getOidcProviderByAlias({ alias: `${organizationSlug}_xyz`, organizationId });
    expect(byAlias?.name).toBe('second');
    expect(byAlias?.organizationId).toBe(organizationId);

    const byId = await repo.getOidcProviderById({ id: all[0].id, organizationId });
    expect(byId?.id).toBe(all[0].id);
  });

  test('listOIDCProviders returns all providers for the org', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    testContext.onTestFinished(() => server.close());

    const first = await client.createOIDCProvider({
      name: 'a',
      clientID: 'a',
      clientSecret: 'secret',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(first.response?.code).toBe(EnumStatusCode.OK);

    const second = await client.createOIDCProvider({
      name: 'b',
      clientID: 'b',
      clientSecret: 'secret',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(second.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.listOIDCProviders({});
    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.providers.map((p) => p.name).sort()).toEqual(['a', 'b']);
    for (const provider of resp.providers) {
      expect(provider.id).toBeTruthy();
      expect(provider.alias).toBeTruthy();
      expect(provider.loginUrl).toContain(`?sso=${provider.alias}`);
      expect(provider.signInRedirectUrl).toContain(`/broker/${provider.alias}/endpoint`);
      expect(provider.signOutRedirectUrl).toContain(`/broker/${provider.alias}/endpoint/logout_response`);
      expect(provider.createdAt).toBeDefined();
    }
  });

  test('Non admins should not be able to list OIDC providers', async (testContext) => {
    const { client, server, authenticator } = await SetupTest({
      dbname,
      enableMultiUsers: true,
      enabledFeatures: ['oidc'],
    });
    testContext.onTestFinished(() => server.close());

    authenticator.changeUser(TestUser.devJoeCompanyA);

    let resp = await client.listOIDCProviders({});
    expect(resp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    resp = await client.listOIDCProviders({});
    expect(resp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
  });
});
