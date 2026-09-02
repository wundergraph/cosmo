import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { createFederatedGraph, DEFAULT_ROUTER_URL, SetupTest } from '../test-util.js';

let dbname = '';

describe('Playground Default Headers', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return empty headers for a graph with none set', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });

    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.graphHeaders).toEqual([]);
    expect(res.personalHeaders).toEqual([]);
    expect(res.canEditGraphHeaders).toBe(true);
  });

  test('Should round-trip graph-level headers', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const updateRes = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.OK);

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.graphHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'x-tenant-id', value: 'acme' }]);
    expect(res.personalHeaders).toEqual([]);
  });

  test('Should round-trip personal headers separately from graph headers', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const updateRes = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer alice' }] },
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.OK);

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.graphHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'x-tenant-id', value: 'acme' }]);
    expect(res.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'Authorization', value: 'Bearer alice' },
    ]);
  });

  test('Updating the same scope twice replaces rather than duplicates', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'a', value: '1' }] },
    });
    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'b', value: '2' }] },
    });

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.graphHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'b', value: '2' }]);
  });

  test('An empty header list clears the stored row', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'a', value: '1' }] },
    });
    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [] },
    });

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.personalHeaders).toEqual([]);
  });

  test('An omitted scope is left untouched', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer alice' }] },
    });

    // Sending only the personal scope must not disturb the graph row.
    const updateRes = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer bob' }] },
    });
    expect(updateRes.response?.code).toBe(EnumStatusCode.OK);

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.graphHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'x-tenant-id', value: 'acme' }]);
    expect(res.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'Authorization', value: 'Bearer bob' },
    ]);
  });

  test('Should reject an invalid header name', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'bad header', value: '1' }] },
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERR);
  });

  test('Should reject a request that provides neither scope', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERR);
  });

  test('An invalid personal list must not persist a valid graph list', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    // The graph list on its own is perfectly valid. Under the old two-call design
    // it would have been committed while the personal call failed, leaving the
    // user with half their edit saved. One transactional call must write nothing.
    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
      personalHeaders: { headers: [{ key: 'bad header', value: '1' }] },
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERR);

    const after = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(after.response?.code).toBe(EnumStatusCode.OK);
    expect(after.graphHeaders).toEqual([]);
    expect(after.personalHeaders).toEqual([]);
  });

  test('A case-only duplicate in the personal list must not persist a valid graph list', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
      personalHeaders: {
        headers: [
          { key: 'X-A', value: '1' },
          { key: 'x-a', value: '2' },
        ],
      },
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERR);

    const after = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(after.graphHeaders).toEqual([]);
    expect(after.personalHeaders).toEqual([]);
  });

  test('Should return ERR_NOT_FOUND for a missing graph', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: 'does-not-exist',
      namespace: 'default',
    });

    expect(res.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test.each(['graph-viewer', 'organization-viewer'])(
    '%s should NOT be able to write graph-level headers but SHOULD be able to write personal headers',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const graphRes = await client.updatePlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
        graphHeaders: { headers: [{ key: 'a', value: '1' }] },
      });
      expect(graphRes.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      const personalRes = await client.updatePlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
        personalHeaders: { headers: [{ key: 'a', value: '1' }] },
      });
      expect(personalRes.response?.code).toBe(EnumStatusCode.OK);

      const getRes = await client.getPlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
      });
      expect(getRes.response?.code).toBe(EnumStatusCode.OK);
      expect(getRes.canEditGraphHeaders).toBe(false);
      expect(getRes.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'a', value: '1' }]);
      expect(getRes.graphHeaders).toEqual([]);
    },
  );

  test.each(['graph-viewer', 'organization-viewer'])(
    '%s bundling both scopes in one call is rejected without writing the permitted scope',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const res = await client.updatePlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
        graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
        personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer me' }] },
      });
      expect(res.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      // Bundling the two scopes into one call must not let the permitted personal
      // write land alongside the forbidden graph write - the whole call is refused
      // before anything is persisted.
      const getRes = await client.getPlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
      });
      expect(getRes.response?.code).toBe(EnumStatusCode.OK);
      expect(getRes.graphHeaders).toEqual([]);
      expect(getRes.personalHeaders).toEqual([]);
    },
  );

  test.each([
    ['CRLF', 'Bearer abc\r\nX-Injected: evil'],
    ['bare LF', 'Bearer abc\nX-Injected: evil'],
    ['NUL', 'Bearer abc\u0000'],
  ])('Should reject a header value containing %s', async (_label, value) => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value }] },
    });
    expect(res.response?.code).toBe(EnumStatusCode.ERR);

    // Rejected before persistence.
    const after = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(after.personalHeaders).toEqual([]);
  });

  test('Should accept a header value containing spaces and tabs', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    // HTAB and space are legal in a field value per RFC 7230; only other C0 controls are not.
    const value = 'Bearer a b\tc';
    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value }] },
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const after = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(after.personalHeaders.map(({ key, value: v }) => ({ key, value: v }))).toEqual([
      { key: 'Authorization', value },
    ]);
  });

  test('Deleting the federated graph removes its stored default headers', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'a', value: '1' }] },
    });

    const deleteRes = await client.deleteFederatedGraph({ name: graphName, namespace: 'default' });
    expect(deleteRes.response?.code).toBe(EnumStatusCode.OK);

    // Recreating the graph under the same name must not resurrect the old row,
    // which proves the ON DELETE CASCADE fired rather than orphaning it.
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);
    expect(res.graphHeaders).toEqual([]);
  });

  test.each(['organization-admin', 'organization-developer', 'graph-admin'])(
    '%s should be able to write graph-level headers',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const res = await client.updatePlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
        graphHeaders: { headers: [{ key: 'a', value: '1' }] },
      });
      expect(res.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test('Clearing one scope leaves the other scope untouched', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'x-tenant-id', value: 'acme' }] },
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer alice' }] },
    });

    // Clearing the personal scope must not touch the graph row.
    const clearPersonalRes = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [] },
    });
    expect(clearPersonalRes.response?.code).toBe(EnumStatusCode.OK);

    const afterPersonalCleared = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(afterPersonalCleared.graphHeaders.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'x-tenant-id', value: 'acme' },
    ]);
    expect(afterPersonalCleared.personalHeaders).toEqual([]);

    // And the symmetric case: restore the personal scope, then clear the graph one.
    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer alice' }] },
    });

    const clearGraphRes = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [] },
    });
    expect(clearGraphRes.response?.code).toBe(EnumStatusCode.OK);

    const afterGraphCleared = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(afterGraphCleared.graphHeaders).toEqual([]);
    expect(afterGraphCleared.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'Authorization', value: 'Bearer alice' },
    ]);
  });

  test.each(['graph', 'personal'] as const)(
    'Should reject duplicate header names that differ only in case (scope %s)',
    async (scope) => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

      const headers = {
        headers: [
          { key: 'X-A', value: '1' },
          { key: 'x-a', value: '2' },
        ],
      };

      const res = await client.updatePlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
        ...(scope === 'graph' ? { graphHeaders: headers } : { personalHeaders: headers }),
      });

      expect(res.response?.code).toBe(EnumStatusCode.ERR);
    },
  );
  test('Updating personal headers twice replaces rather than duplicates', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'a', value: '1' }] },
    });
    // The second write takes the ON CONFLICT path for the personal scope, whose
    // arbiter differs from the graph scope's - it targets (graph, user) WHERE
    // user_id IS NOT NULL.
    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'b', value: '2' }] },
    });

    const res = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(res.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'b', value: '2' }]);
  });

  test("Upserting personal headers leaves another user's personal headers untouched", async () => {
    const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer alice' }] },
    });

    authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);
    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer bob-first' }] },
    });
    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      personalHeaders: { headers: [{ key: 'Authorization', value: 'Bearer bob' }] },
    });

    const bobRes = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(bobRes.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'Authorization', value: 'Bearer bob' },
    ]);

    // A conflict target that omitted user_id would have overwritten Alice's row here.
    authenticator.changeUserWithSuppliedContext(users.adminAliceCompanyA);
    const aliceRes = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(aliceRes.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: 'Authorization', value: 'Bearer alice' },
    ]);
  });

  test('Updating both scopes at once replaces both when both already exist', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'g', value: '1' }] },
      personalHeaders: { headers: [{ key: 'p', value: '1' }] },
    });
    // Both scopes now take the ON CONFLICT path inside a single transaction.
    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'g', value: '2' }] },
      personalHeaders: { headers: [{ key: 'p', value: '2' }] },
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const after = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(after.graphHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'g', value: '2' }]);
    expect(after.personalHeaders.map(({ key, value }) => ({ key, value }))).toEqual([{ key: 'p', value: '2' }]);
  });

  test('Clearing both scopes at once removes both rows', async () => {
    const { client, server } = await SetupTest({ dbname });
    onTestFinished(() => server.close());

    const graphName = genID('fedGraph');
    await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

    await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [{ key: 'g', value: '1' }] },
      personalHeaders: { headers: [{ key: 'p', value: '1' }] },
    });

    const res = await client.updatePlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
      graphHeaders: { headers: [] },
      personalHeaders: { headers: [] },
    });
    expect(res.response?.code).toBe(EnumStatusCode.OK);

    const after = await client.getPlaygroundDefaultHeaders({
      federatedGraphName: graphName,
      namespace: 'default',
    });
    expect(after.graphHeaders).toEqual([]);
    expect(after.personalHeaders).toEqual([]);
  });

  test.each(['graph', 'personal'] as const)(
    'Clearing the %s scope when no row exists is a no-op rather than an error',
    async (scope) => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

      const res = await client.updatePlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
        ...(scope === 'graph' ? { graphHeaders: { headers: [] } } : { personalHeaders: { headers: [] } }),
      });
      expect(res.response?.code).toBe(EnumStatusCode.OK);

      const after = await client.getPlaygroundDefaultHeaders({
        federatedGraphName: graphName,
        namespace: 'default',
      });
      expect(after.graphHeaders).toEqual([]);
      expect(after.personalHeaders).toEqual([]);
    },
  );
});
