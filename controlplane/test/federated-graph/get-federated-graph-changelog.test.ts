import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addMinutes, formatISO, subDays, subYears } from 'date-fns';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { Label } from '../../src/types/index.js';
import {
  createFeatureFlag,
  createFederatedGraph,
  createNamespace,
  DEFAULT_NAMESPACE,
  featureFlagIntegrationTestSetUp,
  SetupTest,
} from '../test-util.js';

let dbname = '';

type TestClient = Awaited<ReturnType<typeof SetupTest>>['client'];

const getChangelog = (
  client: TestClient,
  {
    name,
    namespace,
    featureFlagName,
    limit = 10,
  }: { name: string; namespace: string; featureFlagName?: string; limit?: number },
) =>
  client.getFederatedGraphChangelog({
    name,
    namespace,
    featureFlagName,
    pagination: { limit, offset: 0 },
    dateRange: {
      start: formatISO(subDays(new Date(), 1)),
      end: formatISO(addMinutes(new Date(), 1)),
    },
  });

/**
 * Creates a graph with a feature flag that overrides `products-standalone` (but not `users`), then publishes:
 * 1. the base `users` subgraph, which recomposes both the base graph and the feature flag
 * 2. the `products-standalone-feature` feature subgraph, which only recomposes the feature flag
 */
const setUpGraphWithFeatureFlagChanges = async (client: TestClient) => {
  const namespace = await createNamespace(client, genID('namespace'));
  const labels: Label[] = [];
  const graphName = genID('fedgraph');
  const featureFlagName = genID('feature-flag');

  await featureFlagIntegrationTestSetUp(
    client,
    [
      { name: 'users', hasFeatureSubgraph: false },
      { name: 'products-standalone', hasFeatureSubgraph: true },
    ],
    graphName,
    labels,
    namespace,
  );
  await createFeatureFlag(client, featureFlagName, labels, ['products-standalone-feature'], namespace, true);

  const publishUsersResponse = await client.publishFederatedSubgraph({
    name: 'users',
    namespace,
    schema: `
      type User @key(fields: "id") {
        id: ID!
        name: String!
        email: String!
        isPremium: Boolean! @tag(name: "exclude")
        baseChangelogTestField: String!
      }

      type Query {
        user(id: ID!): User
        users: [User!]!
      }
    `,
  });
  expect(publishUsersResponse.response?.code).toBe(EnumStatusCode.OK);

  const publishFeatureSubgraphResponse = await client.publishFederatedSubgraph({
    name: 'products-standalone-feature',
    namespace,
    schema: `
      type Product @key(fields: "upc sku") {
        upc: Int!
        sku: String!
        details: String!
        isPremium: Boolean! @tag(name: "exclude")
        featureChangelogTestField: String!
      }

      type Query {
        products: [Product!]!
      }
    `,
  });
  expect(publishFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

  return { namespace, graphName, featureFlagName };
};

describe('GetFederatedGraphChangelog', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return empty changelog for a graph with no changes', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
      dateRange: {
        start: formatISO(yesterday),
        end: formatISO(now),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.federatedGraphChangelogOutput).toEqual([]);
    expect(response.hasNextPage).toBe(false);
  });

  test('Should fail when the graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const now = new Date();
    const yesterday = subDays(now, 1);

    const response = await client.getFederatedGraphChangelog({
      name: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
      dateRange: {
        start: formatISO(yesterday),
        end: formatISO(now),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.federatedGraphChangelogOutput).toEqual([]);
    expect(response.hasNextPage).toBe(false);
  });

  test('Should fail when pagination is missing', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      dateRange: {
        start: formatISO(subDays(new Date(), 1)),
        end: formatISO(new Date()),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Please provide pagination and daterange');
  });

  test('Should fail when dateRange is missing', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
    expect(response.response?.details).toBe('Please provide pagination and daterange');
  });

  test('Should fail when dateRange is invalid', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    // Use a very old date (beyond retention) and invalid range
    const response = await client.getFederatedGraphChangelog({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      pagination: { limit: 10, offset: 0 },
      dateRange: {
        start: formatISO(subYears(new Date(), 5)),
        end: formatISO(subYears(new Date(), 4)),
      },
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR);
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get the federated graph changelog',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const getGraphResponse = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [getGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFederatedGraphChangelog({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(subDays(new Date(), 1)),
          end: formatISO(new Date()),
        },
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['graph-admin', 'graph-viewer', 'subgraph-admin', 'subgraph-viewer'])(
    '%s scoped to a different graph should NOT have access',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      // Target graph we'll query
      const targetGraphName = genID('fedgraph');
      await createFederatedGraph(client, targetGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      // A different graph the user WILL be scoped to
      const otherGraphName = genID('other');
      await createFederatedGraph(client, otherGraphName, DEFAULT_NAMESPACE, [], 'http://localhost:8081');

      const otherGraphResponse = await client.getFederatedGraphByName({
        name: otherGraphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(otherGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      // Scope the role only to the OTHER graph, not the target
      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [otherGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getFederatedGraphChangelog({
        name: targetGraphName,
        namespace: DEFAULT_NAMESPACE,
        pagination: { limit: 10, offset: 0 },
        dateRange: {
          start: formatISO(subDays(new Date(), 1)),
          end: formatISO(new Date()),
        },
      });

      expect(response.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );
  test.each([
    { splitConfigLoading: true, title: 'with split config loading' },
    { splitConfigLoading: false, title: 'without split config loading' },
  ])(
    'Should return the base graph and each feature flag changelog separately $title',
    async ({ splitConfigLoading }) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigLoading ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const { namespace, graphName, featureFlagName } = await setUpGraphWithFeatureFlagChanges(client);

      const baseResponse = await getChangelog(client, { name: graphName, namespace });
      expect(baseResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(baseResponse.hasNextPage).toBe(false);

      const featureFlagResponse = await getChangelog(client, { name: graphName, namespace, featureFlagName });
      expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(featureFlagResponse.hasNextPage).toBe(false);

      const featureFlagByNameResponse = await client.getFeatureFlagByName({ name: featureFlagName, namespace });
      expect(featureFlagByNameResponse.response?.code).toBe(EnumStatusCode.OK);
      const featureFlagId = featureFlagByNameResponse.featureFlag!.id;

      // Base graph changelog: only base compositions, no feature flag info, and the feature subgraph change is absent
      expect(baseResponse.federatedGraphChangelogOutput).toEqual([
        expect.objectContaining({
          featureFlagId: '',
          featureFlagName: '',
          changelogs: [expect.objectContaining({ changeType: 'FIELD_ADDED', path: 'User.baseChangelogTestField' })],
        }),
        expect.objectContaining({ featureFlagId: '', featureFlagName: '' }),
      ]);

      // Feature flag changelog: only this flag's compositions. The base `users` change is part of the schema served
      // for the flag, so it shows up here as well.
      expect(featureFlagResponse.federatedGraphChangelogOutput).toEqual([
        expect.objectContaining({
          featureFlagId,
          featureFlagName,
          changelogs: [
            expect.objectContaining({ changeType: 'FIELD_ADDED', path: 'Product.featureChangelogTestField' }),
          ],
        }),
        expect.objectContaining({
          featureFlagId,
          featureFlagName,
          changelogs: [expect.objectContaining({ changeType: 'FIELD_ADDED', path: 'User.baseChangelogTestField' })],
        }),
        expect.objectContaining({ featureFlagId, featureFlagName }),
      ]);

      // The changelog of a single schema version carries the same feature flag info
      const featureFlagVersionResponse = await client.getChangelogBySchemaVersion({
        schemaVersionId: featureFlagResponse.federatedGraphChangelogOutput[0].schemaVersionId,
      });
      expect(featureFlagVersionResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(featureFlagVersionResponse.changelog).toEqual(expect.objectContaining({ featureFlagId, featureFlagName }));

      const baseVersionResponse = await client.getChangelogBySchemaVersion({
        schemaVersionId: baseResponse.federatedGraphChangelogOutput[0].schemaVersionId,
      });
      expect(baseVersionResponse.response?.code).toBe(EnumStatusCode.OK);
      expect(baseVersionResponse.changelog).toEqual(
        expect.objectContaining({ featureFlagId: '', featureFlagName: '' }),
      );
    },
  );

  test('Should only count entries of the selected changelog when paginating', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['split-config-loading'] });
    testContext.onTestFinished(() => server.close());

    const { namespace, graphName, featureFlagName } = await setUpGraphWithFeatureFlagChanges(client);

    // The base graph has 2 changelog entries; the feature flag entries must not make it look like there are more
    const baseResponse = await getChangelog(client, { name: graphName, namespace, limit: 2 });
    expect(baseResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(baseResponse.federatedGraphChangelogOutput.length).toBe(2);
    expect(baseResponse.hasNextPage).toBe(false);

    const featureFlagResponse = await getChangelog(client, { name: graphName, namespace, featureFlagName, limit: 2 });
    expect(featureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(featureFlagResponse.federatedGraphChangelogOutput.length).toBe(2);
    expect(featureFlagResponse.hasNextPage).toBe(true);
  });

  test('Should fail when the feature flag does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await getChangelog(client, {
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      featureFlagName: 'nonexistent',
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toBe('Could not find feature flag nonexistent');
    expect(response.federatedGraphChangelogOutput).toEqual([]);
    expect(response.hasNextPage).toBe(false);
  });
});
