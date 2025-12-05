import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GroupMapper } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAllSetup, beforeAllSetup, TestUser } from '../src/core/test-util.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { SetupTest } from './test-util.js';

let dbname = '';

describe('OIDC provider', (ctx) => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should be able to create an OIDC provider ', async () => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    await server.close();
  });

  test('Non admins should not be able to create an OIDC provider ', async () => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true });
    authenticator.changeUser(TestUser.devJoeCompanyA);

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    let createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
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
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
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

    await server.close();
  });

  test('Should be able to delete an OIDC provider ', async () => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    let getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    const deleteOIDCProviderResponse = await client.deleteOIDCProvider({});
    expect(deleteOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('Non admins should not be able to delete an OIDC provider ', async () => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['oidc'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    authenticator.changeUser(TestUser.devJoeCompanyA);

    let deleteOIDCProviderResponse = await client.deleteOIDCProvider({});
    expect(deleteOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(deleteOIDCProviderResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    authenticator.changeUser(TestUser.viewerTimCompanyA);

    deleteOIDCProviderResponse = await client.deleteOIDCProvider({});
    expect(deleteOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(deleteOIDCProviderResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    await server.close();
  });

  test('Should be able to update mappers of an OIDC provider ', async () => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    let getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    const updateMappersResponse = await client.updateIDPMappers({
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        new GroupMapper({
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });
    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.OK);

    getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(2);

    await server.close();
  });

  test('Non admins should not be able to update mappers of an OIDC provider ', async () => {
    const { client, server, authenticator } = await SetupTest({ dbname, enableMultiUsers: true, enabledFeatures: ['oidc'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const getOIDCProviderResponse = await client.getOIDCProvider({});
    expect(getOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getOIDCProviderResponse.endpoint).toBe('localhost:8080');
    expect(getOIDCProviderResponse.name).toBe('okta');
    expect(getOIDCProviderResponse.mappers).toHaveLength(1);
    expect(getOIDCProviderResponse.mappers[0].groupId).toBe(adminGroup.groupId);
    expect(getOIDCProviderResponse.mappers[0].ssoGroup).toBe('admin_group');

    authenticator.changeUser(TestUser.devJoeCompanyA);

    let updateMappersResponse = await client.updateIDPMappers({
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        new GroupMapper({
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
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        new GroupMapper({
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });
    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    expect(updateMappersResponse.response?.details).toBe(
      'The user does not have the permissions to perform this operation',
    );

    await server.close();
  });

  test('Should not be able to create an OIDC provider when the feature is not enabled', async () => {
    const { client, server } = await SetupTest({ dbname });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });

    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(createOIDCProviderResponse.response?.details).toBe('OIDC feature is not enabled for this organization.');

    await server.close();
  });

  test('Should not be able to update IDP mappers when the feature is not enabled', async () => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });

    const orgGroups = await client.getOrganizationGroups({});
    const adminGroup = orgGroups.groups.find((g) => g.name === 'admin')!;
    const developerGroup = orgGroups.groups.find((g) => g.name === 'developer')!;

    const createOIDCProviderResponse = await client.createOIDCProvider({
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      clientID: '0oab1c2',
      clientSecrect: 'secret',
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
      ],
      name: 'okta',
    });
    expect(createOIDCProviderResponse.response?.code).toBe(EnumStatusCode.OK);

    const orgRepo = new OrganizationRepository(server.log, server.db);
    await orgRepo.updateFeature({ organizationId: users.adminAliceCompanyA.organizationId, id: 'oidc', enabled: false });

    const updateMappersResponse = await client.updateIDPMappers({
      mappers: [
        new GroupMapper({
          groupId: adminGroup.groupId,
          ssoGroup: 'admin_group',
        }),
        new GroupMapper({
          groupId: developerGroup.groupId,
          ssoGroup: 'developer_group',
        }),
      ],
    });

    expect(updateMappersResponse.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);
    expect(updateMappersResponse.response?.details).toBe('OIDC feature is not enabled for this organization.');

    await server.close();
  });
});
