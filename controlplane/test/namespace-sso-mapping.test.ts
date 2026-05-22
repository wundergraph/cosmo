import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import { NamespaceSsoMappingRepository } from '../src/core/repositories/NamespaceSsoMappingRepository.js';
import { DEFAULT_NAMESPACE, SetupTest } from './test-util.js';

let dbname = '';

type TestSetup = Awaited<ReturnType<typeof SetupTest>>;

// SetupTest's authenticator is an org admin, so the namespace/SSO RPCs below
// authorize cleanly. Everything goes through the platform RPCs; creating and
// deleting OIDC providers therefore drives Keycloak, so the tests that use them
// enable the `oidc` feature via SetupTest.
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
    clientSecrect: 'secret',
    discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
    mappers: [],
  });
  expect(created.response?.code).toBe(EnumStatusCode.OK);
  const { providers } = await client.listOIDCProviders({});
  const provider = providers.find((p) => p.name === name);
  expect(provider).toBeDefined();
  return provider!.id;
}

async function setMapping(
  client: TestSetup['client'],
  namespaceId: string,
  allowedSsoProviderIds: string[],
  allowPasswordLogin: boolean,
) {
  const res = await client.updateNamespaceSSOMapping({ namespaceId, allowedSsoProviderIds, allowPasswordLogin });
  expect(res.response?.code).toBe(EnumStatusCode.OK);
}

describe('NamespaceSsoMappingRepository', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test("returns { kind: 'all' } when org has no mapping rows", async () => {
    const { server, users } = await SetupTest({ dbname });
    const repo = new NamespaceSsoMappingRepository(server.db);
    const allowed = await repo.allowedNamespaces({
      organizationId: users.adminAliceCompanyA.organizationId,
      loginMethod: { type: 'password' },
    });
    expect(allowed).toEqual({ kind: 'all' });
    await server.close();
  });

  test('restricts namespaces once a mapping row exists', async () => {
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    const orgId = users.adminAliceCompanyA.organizationId;

    const defaultNsId = await getNamespaceId(client, DEFAULT_NAMESPACE);
    const extraNsId = await createNamespace(client, 'extra');
    const providerId = await createOidcProvider(client, 'staging');

    // Map the default namespace to the SSO provider only (no password).
    await setMapping(client, defaultNsId, [providerId], false);

    const repo = new NamespaceSsoMappingRepository(server.db);

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
    const { client, server, users } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });
    const orgId = users.adminAliceCompanyA.organizationId;

    // The default namespace has no mapping rows, so it doubles as `legacy-ns`.
    const legacyNsId = await getNamespaceId(client, DEFAULT_NAMESPACE);
    const stagingNsId = await createNamespace(client, 'staging-ns');
    const prodNsId = await createNamespace(client, 'prod-ns');
    const sharedNsId = await createNamespace(client, 'shared-ns');

    const stagingId = await createOidcProvider(client, 'staging');
    const prodId = await createOidcProvider(client, 'production');

    await setMapping(client, stagingNsId, [stagingId], false);
    await setMapping(client, prodNsId, [prodId], false);
    await setMapping(client, sharedNsId, [stagingId, prodId], true);
    // legacyNs: no mapping rows → default-open.

    const repo = new NamespaceSsoMappingRepository(server.db);

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

  test('deleting an SSO provider cascades to namespace mappings (reopens namespace)', async () => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['oidc'] });

    const nsId = await createNamespace(client, 'sso-only-ns');
    const providerId = await createOidcProvider(client, 'staging');

    await setMapping(client, nsId, [providerId], false);

    const before = await client.listNamespaceSSOMappings({});
    const beforeEntry = before.mappings.find((m) => m.namespaceId === nsId);
    expect(beforeEntry?.allowedSsoProviderIds).toEqual([providerId]);
    expect(beforeEntry?.allowPasswordLogin).toBe(false);

    // Delete the provider via the RPC; the FK cascade should drop the mapping row.
    const deleted = await client.deleteOIDCProvider({ id: providerId });
    expect(deleted.response?.code).toBe(EnumStatusCode.OK);

    // The namespace is now default-open, so it drops out of the mappings list.
    const after = await client.listNamespaceSSOMappings({});
    expect(after.mappings.find((m) => m.namespaceId === nsId)).toBeUndefined();

    // The repository-level view agrees: no rows for the namespace.
    const remaining = await new NamespaceSsoMappingRepository(server.db).getMapping({ namespaceId: nsId });
    expect(remaining).toEqual([]);

    await server.close();
  });
});
