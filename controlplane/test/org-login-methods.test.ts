import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { pino } from 'pino';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { OrganizationLoginMethodRepository } from '../src/core/repositories/OrganizationLoginMethodRepository.js';
import { OidcRepository } from '../src/core/repositories/OidcRepository.js';
import { OrganizationRepository } from '../src/core/repositories/OrganizationRepository.js';
import { NamespaceLoginMethodRepository } from '../src/core/repositories/NamespaceLoginMethodRepository.js';
import { LoginMethodNotAllowedError } from '../src/core/errors/errors.js';
import { buildAuthState } from '../src/core/util.js';
import { loginAs, SetupTest } from './test-util.js';

let dbname = '';

type TestSetup = Awaited<ReturnType<typeof SetupTest>>;

async function createOidcProvider(client: TestSetup['client'], name: string): Promise<string> {
  const created = await client.createOIDCProvider({
    name,
    clientID: genID('client'),
    clientSecret: 'secret',
    discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
    mappers: [],
  });
  expect(created.response?.code).toBe(EnumStatusCode.OK);
  const { providers } = await client.listOIDCProviders({});
  const provider = providers.find((p) => p.name === name);
  expect(provider).toBeDefined();
  return provider!.id;
}

describe('OrganizationLoginMethodRepository', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });
  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('allows everything when the org has no restriction rows', async () => {
    const { server, users } = await SetupTest({ dbname });
    const repo = new OrganizationLoginMethodRepository(server.db);
    const orgId = users.adminAliceCompanyA.organizationId;

    expect(await repo.isLoginMethodAllowed({ organizationId: orgId, loginMethod: { type: 'password' } })).toBe(true);
    expect(
      await repo.isLoginMethodAllowed({
        organizationId: orgId,
        loginMethod: { type: 'social', provider: 'google', alias: 'google' },
      }),
    ).toBe(true);
    await server.close();
  });

  test('restricts to the configured methods once rows exist', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['oidc', 'login-method-restrictions'],
    });
    const repo = new OrganizationLoginMethodRepository(server.db);
    const orgId = users.adminAliceCompanyA.organizationId;
    const providerId = await createOidcProvider(client, 'okta');

    // Sign in via the SSO app so restricting the org to it does not lock the actor out.
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'sso', ssoProviderId: providerId, alias: 'okta' },
    });

    const res = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [providerId],
      allowPasswordLogin: false,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    expect(
      await repo.isLoginMethodAllowed({
        organizationId: orgId,
        loginMethod: { type: 'sso', ssoProviderId: providerId, alias: 'okta' },
      }),
    ).toBe(true);
    expect(await repo.isLoginMethodAllowed({ organizationId: orgId, loginMethod: { type: 'password' } })).toBe(false);
    expect(await repo.isLoginMethodAllowed({ organizationId: orgId, loginMethod: { type: 'api-key' } })).toBe(true);
    await server.close();
  });

  test('the login-method RPCs require the login-method-restrictions feature', async () => {
    // Default plan does not include the enterprise feature.
    const { client, server } = await SetupTest({ dbname });

    const get = await client.getOrganizationLoginMethods({});
    expect(get.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);

    const list = await client.listNamespaceLoginMethods({});
    expect(list.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);

    const update = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: true,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(update.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);

    await server.close();
  });

  test('GetOrganizationLoginMethods returns unrestricted by default', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['login-method-restrictions'] });
    const res = await client.getOrganizationLoginMethods({});
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.loginMethods?.allowedSsoProviderIds).toEqual([]);
    expect(res.loginMethods?.allowPasswordLogin).toBe(false);
    expect(res.loginMethods?.allowGoogleLogin).toBe(false);
    expect(res.loginMethods?.allowGithubLogin).toBe(false);
    expect(res.loginMethods?.isRestricted).toBe(false);
    await server.close();
  });

  test('UpdateOrganizationLoginMethods treats an empty allow-list as unrestricted (clears the restriction)', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['login-method-restrictions'],
    });
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'password' },
    });
    // First restrict to password only.
    const restrict = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: true,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(restrict.response?.code).toBe(EnumStatusCode.OK);
    expect((await client.getOrganizationLoginMethods({})).loginMethods?.isRestricted).toBe(true);

    // An empty allow-list is the safe default-open state, not an error.
    const clear = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: false,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(clear.response?.code).toBe(EnumStatusCode.OK);
    expect((await client.getOrganizationLoginMethods({})).loginMethods?.isRestricted).toBe(false);
    await server.close();
  });

  test('UpdateOrganizationLoginMethods blocks self-lockout', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['login-method-restrictions'],
    });
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'password' },
    });
    // Disallow password (the actor's method) while allowing google → lockout.
    const res = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: false,
      allowGoogleLogin: true,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERR);
    expect(res.response?.details).toBe(
      'This change would lock you out: your current login method would no longer be allowed. Sign in with an allowed method first, then apply the change.',
    );
    await server.close();
  });

  test('UpdateOrganizationLoginMethods saves when the actor keeps their method', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['login-method-restrictions'],
    });
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'password' },
    });
    const res = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: true,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    const get = await client.getOrganizationLoginMethods({});
    expect(get.loginMethods?.allowPasswordLogin).toBe(true);
    expect(get.loginMethods?.isRestricted).toBe(true);
    await server.close();
  });

  test('tightening the org prunes disallowed methods from namespace mappings (empty -> open)', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['login-method-restrictions'],
    });
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'password' },
    });

    const createdNs = await client.createNamespace({ name: 'staging' });
    expect(createdNs.response?.code).toBe(EnumStatusCode.OK);
    const { namespaces } = await client.getNamespaces({});
    const nsId = namespaces.find((n) => n.name === 'staging')!.id;

    // Namespace mapped to github only.
    const mapped = await client.updateNamespaceLoginMethods({
      mappings: [
        {
          namespaceId: nsId,
          allowedSsoProviderIds: [],
          allowPasswordLogin: false,
          allowGoogleLogin: false,
          allowGithubLogin: true,
        },
      ],
    });
    expect(mapped.response?.code).toBe(EnumStatusCode.OK);

    // Preview (no confirm) → requires confirmation, lists the namespace, no change.
    const preview = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: true,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.affectedNamespaces.map((a) => a.name)).toContain('staging');

    // Confirm → prunes github; mapping becomes empty → default-open (omitted from list).
    const applied = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: true,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: true,
    });
    expect(applied.response?.code).toBe(EnumStatusCode.OK);
    const list = await client.listNamespaceLoginMethods({});
    expect(list.mappings.find((m) => m.namespaceId === nsId)).toBeUndefined();
    await server.close();
  });

  test('namespace mapping cannot reference a method the org disallows', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['login-method-restrictions'],
    });
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'password' },
    });

    // Org restricted to password only.
    const restrict = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: true,
      allowGoogleLogin: false,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(restrict.response?.code).toBe(EnumStatusCode.OK);

    const createdNs = await client.createNamespace({ name: 'prod' });
    expect(createdNs.response?.code).toBe(EnumStatusCode.OK);
    const { namespaces } = await client.getNamespaces({});
    const nsId = namespaces.find((n) => n.name === 'prod')!.id;

    // Try to map the namespace to github (disallowed at org level) → rejected.
    const res = await client.updateNamespaceLoginMethods({
      mappings: [
        {
          namespaceId: nsId,
          allowedSsoProviderIds: [],
          allowPasswordLogin: false,
          allowGoogleLogin: false,
          allowGithubLogin: true,
        },
      ],
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    expect(res.response?.details).toBe('GitHub login is not allowed for this organization.');
    await server.close();
  });

  test('buildAuthState denies a login method the org disallows', async () => {
    const { client, server, users, authenticator } = await SetupTest({
      dbname,
      enabledFeatures: ['login-method-restrictions'],
    });
    const orgId = users.adminAliceCompanyA.organizationId;

    // Sign in via google so restricting the org to google only does not lock the actor out.
    await loginAs({
      authenticator,
      db: server.db,
      base: users.adminAliceCompanyA,
      loginMethod: { type: 'social', provider: 'google', alias: 'google' },
    });

    // Restrict org to google only → password (the default login method) is denied.
    const restrict = await client.updateOrganizationLoginMethods({
      allowedSsoProviderIds: [],
      allowPasswordLogin: false,
      allowGoogleLogin: true,
      allowGithubLogin: false,
      confirmNamespaceChanges: false,
    });
    expect(restrict.response?.code).toBe(EnumStatusCode.OK);

    const deps = {
      oidcRepo: new OidcRepository(server.db),
      orgRepo: new OrganizationRepository(pino(), server.db, undefined),
      namespaceLoginMethodRepo: new NamespaceLoginMethodRepository(server.db),
      orgLoginMethodRepo: new OrganizationLoginMethodRepository(server.db),
    };

    // idpAlias null resolves to password, which the org no longer allows.
    await expect(
      buildAuthState(deps, { organizationId: orgId, userId: users.adminAliceCompanyA.userId, idpAlias: null }),
    ).rejects.toBeInstanceOf(LoginMethodNotAllowedError);

    await server.close();
  });
});
