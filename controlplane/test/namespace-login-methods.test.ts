import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { NamespaceLoginMethodRepository } from '../src/core/repositories/NamespaceLoginMethodRepository.js';
import { DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

type TestSetup = Awaited<ReturnType<typeof SetupTest>>;

// SetupTest's authenticator is an org admin, so the namespace/SSO RPCs below
// authorize cleanly. Everything goes through the platform RPCs; creating and
// deleting OIDC providers therefore drives Keycloak, so the tests that use them
// enable the `oidc` feature via SetupTest. The namespace SSO mapping RPCs are
// gated behind the enterprise `login-method-restrictions` feature, so tests that
// call them enable it too.
async function createNamespace(client: TestSetup['client'], name: string): Promise<string> {
  const created = await client.createNamespace({ name });
  expect(created.response?.code).toBe(EnumStatusCode.OK);
  return getNamespaceId(client, name);
}

async function getNamespaceId(client: TestSetup['client'], name: string): Promise<string> {
  const { namespaces } = await client.getNamespaces({});
  const ns = namespaces.find((n) => n.name === name);
  expect(ns).toBeDefined();
  return ns!.id;
}

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

// Replaces the org's mappings via the platform RPC for test setup.
async function setMappings(
  client: TestSetup['client'],
  mappings: {
    namespaceId: string;
    allowedSsoProviderIds?: string[];
    allowPasswordLogin?: boolean;
    allowGoogleLogin?: boolean;
    allowGithubLogin?: boolean;
  }[],
) {
  const res = await client.updateNamespaceLoginMethods({
    mappings: mappings.map((m) => ({
      namespaceId: m.namespaceId,
      allowedSsoProviderIds: m.allowedSsoProviderIds ?? [],
      allowPasswordLogin: m.allowPasswordLogin ?? false,
      allowGoogleLogin: m.allowGoogleLogin ?? false,
      allowGithubLogin: m.allowGithubLogin ?? false,
    })),
  });
  expect(res.response?.code).toBe(EnumStatusCode.OK);
}

describe('NamespaceLoginMethodRepository', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test("returns { kind: 'all' } when org has no mapping rows", async () => {
    const { server, users } = await SetupTest({ dbname });
    const repo = new NamespaceLoginMethodRepository(server.db);
    const allowed = await repo.allowedNamespaces({
      organizationId: users.adminAliceCompanyA.organizationId,
      loginMethod: { type: 'password' },
    });
    expect(allowed).toEqual({ kind: 'all' });
    await server.close();
  });

  test('restricts namespaces once a mapping row exists', async () => {
    const { client, server, users } = await SetupTest({
      dbname,
      enabledFeatures: ['oidc', 'login-method-restrictions'],
    });
    const orgId = users.adminAliceCompanyA.organizationId;

    const defaultNsId = await getNamespaceId(client, DEFAULT_NAMESPACE);
    const extraNsId = await createNamespace(client, 'extra');
    const providerId = await createOidcProvider(client, 'staging');

    // Map the default namespace to the SSO provider only (no password).
    await setMappings(client, [{ namespaceId: defaultNsId, allowedSsoProviderIds: [providerId] }]);

    const repo = new NamespaceLoginMethodRepository(server.db);

    const ssoAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'sso', ssoProviderId: providerId, alias: 'staging-alias' },
    });
    expect(ssoAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([defaultNsId, extraNsId]) });

    const pwAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'password' },
    });
    expect(pwAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([extraNsId]) }); // defaultNs restricted

    await server.close();
  });

  test('gates namespace access by login method (full matrix)', async () => {
    const { client, server, users } = await SetupTest({
      dbname,
      enabledFeatures: ['oidc', 'login-method-restrictions'],
    });
    const orgId = users.adminAliceCompanyA.organizationId;

    // The default namespace has no mapping rows, so it doubles as `legacy-ns`.
    const legacyNsId = await getNamespaceId(client, DEFAULT_NAMESPACE);
    const stagingNsId = await createNamespace(client, 'staging-ns');
    const prodNsId = await createNamespace(client, 'prod-ns');
    const sharedNsId = await createNamespace(client, 'shared-ns');

    const stagingId = await createOidcProvider(client, 'staging');
    const prodId = await createOidcProvider(client, 'production');

    await setMappings(client, [
      { namespaceId: stagingNsId, allowedSsoProviderIds: [stagingId] },
      { namespaceId: prodNsId, allowedSsoProviderIds: [prodId] },
      { namespaceId: sharedNsId, allowedSsoProviderIds: [stagingId, prodId], allowPasswordLogin: true },
    ]);
    // legacyNs: no mapping rows → default-open.

    const repo = new NamespaceLoginMethodRepository(server.db);

    // Staging IdP.
    const stagingAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'sso', ssoProviderId: stagingId, alias: 'staging-alias' },
    });
    expect(stagingAllowed).toEqual({
      kind: 'restricted',
      namespaceIds: new Set([stagingNsId, sharedNsId, legacyNsId]),
    });

    // Production IdP.
    const prodAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'sso', ssoProviderId: prodId, alias: 'prod-alias' },
    });
    expect(prodAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([prodNsId, sharedNsId, legacyNsId]) });

    // Password login.
    const pwAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'password' },
    });
    expect(pwAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([sharedNsId, legacyNsId]) });

    // API keys are not gated.
    const apiKeyAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'api-key' },
    });
    expect(apiKeyAllowed).toEqual({ kind: 'all' });

    await server.close();
  });

  test('gates namespace access by social login (google/github are separate)', async () => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['login-method-restrictions'] });
    const orgId = users.adminAliceCompanyA.organizationId;

    const legacyNsId = await getNamespaceId(client, DEFAULT_NAMESPACE);
    const googleNsId = await createNamespace(client, 'google-ns');
    const githubNsId = await createNamespace(client, 'github-ns');

    // Each social provider is its own entry; google-ns allows only Google, etc.
    await setMappings(client, [
      { namespaceId: googleNsId, allowGoogleLogin: true },
      { namespaceId: githubNsId, allowGithubLogin: true },
    ]);

    const repo = new NamespaceLoginMethodRepository(server.db);

    // Google login → google-ns + open(default), not github-ns.
    const googleAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'social', provider: 'google', alias: 'google' },
    });
    expect(googleAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([googleNsId, legacyNsId]) });

    // GitHub login → github-ns + open(default), not google-ns.
    const githubAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'social', provider: 'github', alias: 'github' },
    });
    expect(githubAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([githubNsId, legacyNsId]) });

    // Password login → only open(default); neither social-only namespace.
    const pwAllowed = await repo.allowedNamespaces({
      organizationId: orgId,
      loginMethod: { type: 'password' },
    });
    expect(pwAllowed).toEqual({ kind: 'restricted', namespaceIds: new Set([legacyNsId]) });

    await server.close();
  });

  test('updateNamespaceLoginMethods replaces the org mappings in one call', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['login-method-restrictions'] });

    const nsA = await createNamespace(client, 'bulk-a');
    const nsB = await createNamespace(client, 'bulk-b');

    // Restrict A to password and B to Google.
    const first = await client.updateNamespaceLoginMethods({
      mappings: [
        { namespaceId: nsA, allowPasswordLogin: true },
        { namespaceId: nsB, allowGoogleLogin: true },
      ],
    });
    expect(first.response?.code).toBe(EnumStatusCode.OK);

    let listed = await client.listNamespaceLoginMethods({});
    expect(listed.mappings.find((m) => m.namespaceId === nsA)?.allowPasswordLogin).toBe(true);
    expect(listed.mappings.find((m) => m.namespaceId === nsB)?.allowGoogleLogin).toBe(true);

    // Replace with only A (now GitHub) — B drops out of the payload, so it is
    // reset to default-open.
    const second = await client.updateNamespaceLoginMethods({
      mappings: [{ namespaceId: nsA, allowGithubLogin: true }],
    });
    expect(second.response?.code).toBe(EnumStatusCode.OK);

    listed = await client.listNamespaceLoginMethods({});
    const aEntry = listed.mappings.find((m) => m.namespaceId === nsA);
    expect(aEntry?.allowGithubLogin).toBe(true);
    expect(aEntry?.allowPasswordLogin).toBe(false);
    expect(listed.mappings.find((m) => m.namespaceId === nsB)).toBeUndefined();

    await server.close();
  });

  test('updateNamespaceLoginMethods rejects a namespace listed more than once', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['login-method-restrictions'] });

    const nsId = await createNamespace(client, 'dup-ns');
    const res = await client.updateNamespaceLoginMethods({
      mappings: [
        { namespaceId: nsId, allowPasswordLogin: true },
        { namespaceId: nsId, allowGoogleLogin: true },
      ],
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

    // Nothing was written — the namespace stays default-open.
    const listed = await client.listNamespaceLoginMethods({});
    expect(listed.mappings.find((m) => m.namespaceId === nsId)).toBeUndefined();

    await server.close();
  });

  test('namespace SSO mapping RPCs return ERR_UPGRADE_PLAN without the login-method-restrictions feature', async () => {
    // Default plan does not include the enterprise feature.
    const { client, server } = await SetupTest({ dbname });

    const list = await client.listNamespaceLoginMethods({});
    expect(list.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);

    const update = await client.updateNamespaceLoginMethods({
      mappings: [
        {
          namespaceId: await getNamespaceId(client, DEFAULT_NAMESPACE),
          allowedSsoProviderIds: [],
          allowPasswordLogin: true,
          allowGoogleLogin: false,
          allowGithubLogin: false,
        },
      ],
    });
    expect(update.response?.code).toBe(EnumStatusCode.ERR_UPGRADE_PLAN);

    await server.close();
  });

  test('deleting an SSO provider cascades to namespace mappings (reopens namespace)', async () => {
    const { client, server, users } = await SetupTest({
      dbname,
      enabledFeatures: ['oidc', 'login-method-restrictions'],
    });
    const orgId = users.adminAliceCompanyA.organizationId;

    const nsId = await createNamespace(client, 'sso-only-ns');
    const providerId = await createOidcProvider(client, 'staging');

    await setMappings(client, [{ namespaceId: nsId, allowedSsoProviderIds: [providerId] }]);

    const before = await client.listNamespaceLoginMethods({});
    const beforeEntry = before.mappings.find((m) => m.namespaceId === nsId);
    expect(beforeEntry?.allowedSsoProviderIds).toEqual([providerId]);
    expect(beforeEntry?.allowPasswordLogin).toBe(false);

    // Delete the provider via the RPC; the FK cascade should drop the mapping row.
    const deleted = await client.deleteOIDCProvider({ id: providerId });
    expect(deleted.response?.code).toBe(EnumStatusCode.OK);

    // The namespace is now default-open, so it drops out of the mappings list.
    const after = await client.listNamespaceLoginMethods({});
    expect(after.mappings.find((m) => m.namespaceId === nsId)).toBeUndefined();

    await server.close();
  });
});
