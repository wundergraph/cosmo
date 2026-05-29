import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAllSetup, beforeAllSetup, genID, UserTestData } from '../src/core/test-util.js';
import type { AuthContext, LoginMethod } from '../src/types/index.js';
import { createFederatedGraph, createSubgraph, loginAs, SetupTest } from './test-util.js';

// ---------------------------------------------------------------------------
// IdP gate, end-to-end through the real RPCs.
//
// Setup mirrors the product flow: create an SSO provider, a few namespaces, a
// graph + subgraph in each, then map the namespaces to login methods:
//   ssoNs      → the SSO provider only
//   passwordNs → password only
//   openNs     → unmapped  (default-open)
//   default    → unmapped  (default-open)
//
// The one thing the mocked test authenticator can't do is the bit of
// `Authentication.authenticate()` that turns the session's idp_alias into a
// login method and resolves the allowed-namespace set. The shared `loginAs`
// helper (test-util) reproduces exactly that step — using the same repository
// the real code uses — and injects the result into the auth context.
// ---------------------------------------------------------------------------

let dbname = '';

describe('IdP gate (namespace ↔ SSO/password mapping)', () => {
  let setup: Awaited<ReturnType<typeof SetupTest>>;
  let base: UserTestData & AuthContext;
  let providerId: string;
  let providerAlias: string;

  const ssoNs = 'sso-ns';
  const passwordNs = 'password-ns';
  const openNs = 'open-ns';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
    setup = await SetupTest({ dbname, enabledFeatures: ['oidc', 'login-method-restrictions'] });
    base = setup.users.adminAliceCompanyA;

    const { client } = setup;

    // SSO provider.
    const createProvider = await client.createOIDCProvider({
      name: 'okta',
      clientID: 'client',
      clientSecret: 'secret',
      discoveryEndpoint: 'http://localhost:8080/realms/test/.well-known/openid-configuration',
      mappers: [],
    });
    expect(createProvider.response?.code).toBe(EnumStatusCode.OK);

    const { providers } = await client.listOIDCProviders({});
    const provider = providers.find((p) => p.name === 'okta')!;
    expect(provider).toBeDefined();
    providerId = provider.id;
    providerAlias = provider.alias;

    // A namespace per login method, each with a graph + subgraph.
    for (const name of [ssoNs, passwordNs, openNs]) {
      const created = await client.createNamespace({ name });
      expect(created.response?.code).toBe(EnumStatusCode.OK);
      await createFederatedGraph(client, genID('fg'), name, [], 'http://localhost:8081');
      await createSubgraph(client, genID('sg'), 'http://localhost:8082', name);
    }

    // Map namespaces to login methods. openNs / default are left unmapped.
    const { namespaces } = await client.getNamespaces({});
    const idOf = (name: string) => namespaces.find((n) => n.name === name)!.id;

    const mapped = await client.updateNamespaceLoginMethods({
      mappings: [
        { namespaceId: idOf(ssoNs), allowedSsoProviderIds: [providerId] },
        { namespaceId: idOf(passwordNs), allowPasswordLogin: true },
      ],
    });
    expect(mapped.response?.code).toBe(EnumStatusCode.OK);
  });

  afterAll(async () => {
    await setup?.server.close();
    await afterAllSetup(dbname);
  });

  const login = (loginMethod: LoginMethod) =>
    loginAs({ authenticator: setup.authenticator, db: setup.server.db, base, loginMethod });

  async function visibleNamespaceNames() {
    const { namespaces } = await setup.client.getNamespaces({});
    return namespaces.map((n) => n.name);
  }

  async function visibleGraphNamespaces() {
    const { graphs } = await setup.client.getFederatedGraphs({ limit: 100, offset: 0, namespace: '' });
    return new Set(graphs.map((g) => g.namespace));
  }

  async function visibleSubgraphNamespaces() {
    const { graphs } = await setup.client.getSubgraphs({ limit: 100, offset: 0, namespace: '' });
    return new Set(graphs.map((g) => g.namespace));
  }

  test('SSO login sees namespaces mapped to that app plus open ones, not password-only ones', async () => {
    await login({ type: 'sso', ssoProviderId: providerId, alias: providerAlias });

    const names = await visibleNamespaceNames();
    expect(names).toContain(ssoNs);
    expect(names).toContain(openNs);
    expect(names).toContain('default');
    expect(names).not.toContain(passwordNs);

    const graphNs = await visibleGraphNamespaces();
    expect(graphNs.has(ssoNs)).toBe(true);
    expect(graphNs.has(openNs)).toBe(true);
    expect(graphNs.has(passwordNs)).toBe(false);

    const subgraphNs = await visibleSubgraphNamespaces();
    expect(subgraphNs.has(ssoNs)).toBe(true);
    expect(subgraphNs.has(passwordNs)).toBe(false);
  });

  test('password login sees password-mapped namespaces plus open ones, not SSO-only ones', async () => {
    await login({ type: 'password' });

    const names = await visibleNamespaceNames();
    expect(names).toContain(passwordNs);
    expect(names).toContain(openNs);
    expect(names).toContain('default');
    expect(names).not.toContain(ssoNs);

    const graphNs = await visibleGraphNamespaces();
    expect(graphNs.has(passwordNs)).toBe(true);
    expect(graphNs.has(ssoNs)).toBe(false);
  });

  test('SSO login from a different app sees only the open namespaces', async () => {
    // Same user, but authenticated through a different SSO app than the one
    // ssoNs is mapped to — the customer's "treat as different identities" case.
    await login({ type: 'sso', ssoProviderId: randomUUID(), alias: 'some-other-app' });

    const names = await visibleNamespaceNames();
    expect(names).toContain(openNs);
    expect(names).toContain('default');
    expect(names).not.toContain(ssoNs);
    expect(names).not.toContain(passwordNs);
  });

  test('API-key access is never gated and sees every namespace', async () => {
    await login({ type: 'api-key' });

    const names = await visibleNamespaceNames();
    expect(names).toContain(ssoNs);
    expect(names).toContain(passwordNs);
    expect(names).toContain(openNs);
    expect(names).toContain('default');
  });
});
