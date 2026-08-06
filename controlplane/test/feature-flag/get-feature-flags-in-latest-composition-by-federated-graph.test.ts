import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createNamespace,
  createThenPublishFeatureSubgraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('GetFeatureFlagsInLatestCompositionByFederatedGraph', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return only feature flags in the latest valid composition', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labels = [genUniqueLabel()];
    const federatedGraphName = genID('fedGraph');

    await createAndPublishSubgraph(
      client,
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature',
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labels,
      'http://localhost:4101',
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, labels, ['users-feature'], 'default', true);

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureFlags.length).toBeGreaterThanOrEqual(1);
    expect(resp.featureFlags.some((f) => f.name === flagName)).toBe(true);
  });

  test('that feature flags in the latest composition are returned when split config loading is enabled', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, enabledFeatures: ['split-config-loading'] });
    testContext.onTestFinished(() => server.close());

    const namespace = genID('namespace').toLowerCase();
    const labels = [genUniqueLabel()];
    const federatedGraphName = genID('fedGraph');

    await createNamespace(client, namespace);

    await createAndPublishSubgraph(
      client,
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature',
      'users',
      namespace,
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labels,
      'http://localhost:4101',
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, labels, ['users-feature'], namespace, true);

    // recomposeFeatureFlag recomposes only the feature flag against the existing base composition (the base
    // schema version is unchanged). Each call creates another feature flag composition for the same\
    // (base composition, feature flag) pair, which is the source of the duplicates in the dropdown.
    const recomposeResp1 = await client.recomposeFeatureFlag({ name: flagName, namespace });
    expect(recomposeResp1.response?.code).toBe(EnumStatusCode.OK);

    const recomposeResp2 = await client.recomposeFeatureFlag({ name: flagName, namespace });
    expect(recomposeResp2.response?.code).toBe(EnumStatusCode.OK);

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureFlags).toHaveLength(1);
    expect(resp.featureFlags.some((f) => f.name === flagName)).toBe(true);

    // Create a second, enabled feature flag
    const secondFlagName = genID('flag');
    await createFeatureFlag(client, secondFlagName, labels, ['users-feature'], namespace, true);

    const withSecondFlag = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace,
    });
    expect(withSecondFlag.response?.code).toBe(EnumStatusCode.OK);
    expect(withSecondFlag.featureFlags).toHaveLength(2);
    expect(withSecondFlag.featureFlags.some((f) => f.name === flagName)).toBe(true);
    expect(withSecondFlag.featureFlags.some((f) => f.name === secondFlagName)).toBe(true);

    // Only the base graph composition should show up when excluding feature flag compositions
    let compositionsResp = await client.getCompositions({
      fedGraphName: federatedGraphName,
      namespace,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
      excludeFeatureFlagCompositions: true,
    });

    expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsResp.compositions).toHaveLength(1);
    expect(compositionsResp.compositions).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ isFeatureFlagComposition: false })]),
    );

    // Feature flag compositions should show up in the composition list
    compositionsResp = await client.getCompositions({
      fedGraphName: federatedGraphName,
      namespace,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });

    expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsResp.compositions).toHaveLength(5);
    expect(compositionsResp.compositions).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureFlagName: flagName, isFeatureFlagComposition: true }),
        expect.objectContaining({ featureFlagName: flagName, isFeatureFlagComposition: true }),
        expect.objectContaining({ featureFlagName: flagName, isFeatureFlagComposition: true }),
        expect.objectContaining({ featureFlagName: secondFlagName, isFeatureFlagComposition: true }),
      ]),
    );
  });

  test('Should return empty list when no feature flags exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labels = [genUniqueLabel()];
    const federatedGraphName = genID('fedGraph');

    await createAndPublishSubgraph(
      client,
      genID('subgraph'),
      'default',
      'type Query { hello: String! }',
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureFlags).toHaveLength(0);
  });

  test.each([true, false])(
    'that a feature flag whose latest composition failed is kept only under split config (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels = [genUniqueLabel()];
      const federatedGraphName = genID('fedGraph');

      await createNamespace(client, namespace);

      await createAndPublishSubgraph(
        client,
        'users',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
        labels,
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      await createAndPublishSubgraph(
        client,
        'products-standalone',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone.graphql')).toString(),
        labels,
        'http://localhost:4002',
      );

      // A feature subgraph for `users` that mirrors the base schema plus one extra field, so it composes on its own
      await createThenPublishFeatureSubgraph(
        client,
        'users-ff',
        'users',
        namespace,
        `
        type User @key(fields: "id") {
          id: ID!
          name: String!
          email: String!
          isPremium: Boolean! @tag(name: "exclude")
          nickname: String!
        }

        type Query {
          user(id: ID!): User
          users: [User!]!
        }
      `,
        labels,
        'http://localhost:4101',
      );

      await createThenPublishFeatureSubgraph(
        client,
        'products-standalone-feature',
        'products-standalone',
        namespace,
        fs
          .readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone-feature.graphql'))
          .toString(),
        labels,
        'http://localhost:4102',
      );

      const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
      await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

      // Two enabled flags, each built on its own feature subgraph, both composing successfully
      const successfulFlagName = genID('flag');
      await createFeatureFlag(client, successfulFlagName, labels, ['products-standalone-feature'], namespace, true);

      const failingFlagName = genID('flag');
      await createFeatureFlag(client, failingFlagName, labels, ['users-ff'], namespace, true);

      let resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.featureFlags).toHaveLength(2);

      /**
       * Break the composition of only the second flag by declaring `Product.details` with a type that conflicts with the
       * `products-standalone` subgraph (`String!` there, `Int!` here). This is published to a feature subgraph, so the
       * base composition itself does not fail, and the other flag still composes. Note this does not mean the base
       * schema version is unchanged: in legacy every flag event runs `legacyComposeAndDeploy`, which recomposes the base
       * graph and bumps `federatedGraphs.composedSchemaVersionId` regardless.
       */
      const publishResp = await client.publishFederatedSubgraph({
        name: 'users-ff',
        namespace,
        schema: `
        type User @key(fields: "id") {
          id: ID!
          name: String!
          email: String!
          isPremium: Boolean! @tag(name: "exclude")
        }

        type Product @key(fields: "upc sku") {
          upc: Int!
          sku: String!
          details: Int!
        }

        type Query {
          user(id: ID!): User
          users: [User!]!
        }
      `,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
      expect(publishResp.compositionErrors.length).toBeGreaterThan(0);

      resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      if (splitConfigEnabled) {
        /**
         * Split config scopes the lookup by federated graph, so the flag falls back to its last valid composition and
         * stays listed.
         */
        expect(new Set(resp.featureFlags.map((f) => f.name))).toStrictEqual(
          new Set([successfulFlagName, failingFlagName]),
        );
      } else {
        /**
         * Legacy anchors the lookup to the base schema version, and every flag event bumps that version, so the flag's
         * earlier valid composition is not reachable from the current base. The flag is dropped rather than falling back.
         */
        expect(new Set(resp.featureFlags.map((f) => f.name))).toStrictEqual(new Set([successfulFlagName]));
      }
    },
  );

  test.each([true, false])(
    'that only the flag whose latest composition failed is reported as stale (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels = [genUniqueLabel()];
      const federatedGraphName = genID('fedGraph');

      await createNamespace(client, namespace);

      await createAndPublishSubgraph(
        client,
        'users',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
        labels,
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      await createAndPublishSubgraph(
        client,
        'products-standalone',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone.graphql')).toString(),
        labels,
        'http://localhost:4002',
      );

      await createThenPublishFeatureSubgraph(
        client,
        'users-ff',
        'users',
        namespace,
        `
          type User @key(fields: "id") {
            id: ID!
            name: String!
            email: String!
            isPremium: Boolean! @tag(name: "exclude")
            nickname: String!
          }

          type Query {
            user(id: ID!): User
            users: [User!]!
          }
        `,
        labels,
        'http://localhost:4101',
      );

      await createThenPublishFeatureSubgraph(
        client,
        'products-standalone-feature',
        'products-standalone',
        namespace,
        fs
          .readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone-feature.graphql'))
          .toString(),
        labels,
        'http://localhost:4102',
      );

      const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
      await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

      const healthyFlagName = genID('flag');
      await createFeatureFlag(client, healthyFlagName, labels, ['products-standalone-feature'], namespace, true);

      const staleFlagName = genID('flag');
      await createFeatureFlag(client, staleFlagName, labels, ['users-ff'], namespace, true);

      // Nothing has failed yet, so nothing is stale
      let resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });
      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.featureFlags.every((f) => f.hasFailedLatestComposition === false)).toBe(true);

      // Break only the second flag: `Product.details` is `String!` in products-standalone, `Int!` here
      const publishResp = await client.publishFederatedSubgraph({
        name: 'users-ff',
        namespace,
        schema: `
          type User @key(fields: "id") {
            id: ID!
            name: String!
            email: String!
            isPremium: Boolean! @tag(name: "exclude")
          }

          type Product @key(fields: "upc sku") {
            upc: Int!
            sku: String!
            details: Int!
          }

          type Query {
            user(id: ID!): User
            users: [User!]!
          }
        `,
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });
      expect(resp.response?.code).toBe(EnumStatusCode.OK);

      if (splitConfigEnabled) {
        // The flag falls back to its last valid composition, so it is listed and reported stale
        expect(resp.featureFlags).toHaveLength(2);
        expect(resp.featureFlags.find((f) => f.name === staleFlagName)?.hasFailedLatestComposition).toBe(true);
        // Only the broken flag is stale — the healthy one must not be tarred with it
        expect(resp.featureFlags.find((f) => f.name === healthyFlagName)?.hasFailedLatestComposition).toBe(false);
      } else {
        /**
         * Legacy drops the flag entirely rather than falling back (see Global Constraints), so there is nothing to
         * report as stale.
         */
        expect(resp.featureFlags.map((f) => f.name)).toStrictEqual([healthyFlagName]);
        expect(resp.featureFlags.every((f) => f.hasFailedLatestComposition === false)).toBe(true);
      }
    },
  );

  test.each([true, false])(
    'that a feature flag with no valid composition is not returned (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels = [genUniqueLabel()];
      const federatedGraphName = genID('fedGraph');

      await createNamespace(client, namespace);

      await createAndPublishSubgraph(
        client,
        'users',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
        labels,
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      await createAndPublishSubgraph(
        client,
        'products-standalone',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone.graphql')).toString(),
        labels,
        'http://localhost:4002',
      );

      /**
       * Publish a feature subgraph that already conflicts with `products-standalone` (`Product.details` is `String!`
       * there, `Int!` here). A feature subgraph is not composed until a flag attaches it, so this publish succeeds and
       * the flag's very first composition is the one that fails.
       */
      await createThenPublishFeatureSubgraph(
        client,
        'users-ff',
        'users',
        namespace,
        `
          type User @key(fields: "id") {
            id: ID!
            name: String!
            email: String!
            isPremium: Boolean! @tag(name: "exclude")
          }

          type Product @key(fields: "upc sku") {
            upc: Int!
            sku: String!
            details: Int!
          }

          type Query {
            user(id: ID!): User
            users: [User!]!
          }
        `,
        labels,
        'http://localhost:4101',
      );

      const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
      await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

      // Created directly rather than via the createFeatureFlag helper, which asserts an OK response
      const neverValidFlagName = genID('flag');
      const createResp = await client.createFeatureFlag({
        name: neverValidFlagName,
        featureSubgraphNames: ['users-ff'],
        labels,
        namespace,
        isEnabled: true,
      });
      expect(createResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      // The flag exists but has never composed successfully, so it must not be reported
      const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.featureFlags).toHaveLength(0);
    },
  );

  test('Should return ERR_NOT_FOUND for non-existent federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName: 'non-existent-graph',
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test.each([true, false])(
    'that feature flags survive a failed base composition (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels = [genUniqueLabel()];
      const federatedGraphName = genID('fedGraph');

      await createNamespace(client, namespace);

      await createAndPublishSubgraph(
        client,
        'users',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
        labels,
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      await createAndPublishSubgraph(
        client,
        'products',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products.graphql')).toString(),
        labels,
        'http://localhost:4002',
      );

      await createThenPublishFeatureSubgraph(
        client,
        'users-ff',
        'users',
        namespace,
        `
          type User @key(fields: "id") {
            id: ID!
            email: String!
            isPremium: Boolean! @tag(name: "exclude")
            nickname: String!
          }

          type Query {
            user(id: ID!): User
            users: [User!]!
          }
        `,
        labels,
        'http://localhost:4101',
      );

      const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
      await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

      const flagName = genID('flag');
      await createFeatureFlag(client, flagName, labels, ['users-ff'], namespace, true);

      const before = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });
      expect(before.featureFlags.map((f) => f.name)).toStrictEqual([flagName]);

      /**
       * Break the BASE composition by publishing a schema that redeclares the non-shareable `User.email` already owned
       * by the `users` subgraph.
       */
      const publishResp = await client.publishFederatedSubgraph({
        name: 'products',
        namespace,
        schema: fs
          .readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-failing.graphql'))
          .toString(),
      });
      expect(publishResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);

      /**
       * The flag must still be reported. A failed base composition still advances the graph's
       * `composedSchemaVersionId`, and that failed version has no feature flag rows at all, so anchoring to it would
       * wrongly report zero flags while the router keeps serving the last valid base composition and its flags. Both
       * callers therefore anchor on the latest *valid* base schema version.
       */
      const after = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });
      expect(after.response?.code).toBe(EnumStatusCode.OK);
      expect(after.featureFlags.map((f) => f.name)).toStrictEqual([flagName]);
    },
  );

  test.each([true, false])(
    'that a disabled feature flag is not reported (split config: %s)',
    async (splitConfigEnabled) => {
      const { client, server } = await SetupTest({
        dbname,
        enabledFeatures: splitConfigEnabled ? ['split-config-loading'] : [],
      });
      onTestFinished(() => server.close());

      const namespace = genID('namespace').toLowerCase();
      const labels = [genUniqueLabel()];
      const federatedGraphName = genID('fedGraph');

      await createNamespace(client, namespace);

      await createAndPublishSubgraph(
        client,
        'users',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
        labels,
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      await createAndPublishSubgraph(
        client,
        'products-standalone',
        namespace,
        fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone.graphql')).toString(),
        labels,
        'http://localhost:4002',
      );

      await createThenPublishFeatureSubgraph(
        client,
        'users-ff',
        'users',
        namespace,
        `
          type User @key(fields: "id") {
            id: ID!
            name: String!
            email: String!
            isPremium: Boolean! @tag(name: "exclude")
            nickname: String!
          }

          type Query {
            user(id: ID!): User
            users: [User!]!
          }
        `,
        labels,
        'http://localhost:4101',
      );

      await createThenPublishFeatureSubgraph(
        client,
        'products-standalone-feature',
        'products-standalone',
        namespace,
        fs
          .readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-standalone-feature.graphql'))
          .toString(),
        labels,
        'http://localhost:4102',
      );

      const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
      await createFederatedGraph(client, federatedGraphName, namespace, federatedGraphLabels, DEFAULT_ROUTER_URL);

      const enabledFlagName = genID('flag');
      await createFeatureFlag(client, enabledFlagName, labels, ['products-standalone-feature'], namespace, true);

      const disabledFlagName = genID('flag');
      await createFeatureFlag(client, disabledFlagName, labels, ['users-ff'], namespace, true);

      // Both compose successfully, so both are reported to begin with
      let resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });
      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(new Set(resp.featureFlags.map((f) => f.name))).toStrictEqual(new Set([enabledFlagName, disabledFlagName]));

      const disableResp = await client.enableFeatureFlag({ name: disabledFlagName, namespace, enabled: false });
      expect(disableResp.response?.code).toBe(EnumStatusCode.OK);

      resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
        federatedGraphName,
        namespace,
      });
      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.featureFlags.map((f) => f.name)).toStrictEqual([enabledFlagName]);
    },
  );
});
