import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
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

  test('that a feature flag is still returned when its latest composition failed', async (testContext) => {
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
     * base composition — and therefore the graph's base schema version — is untouched, and the other flag still
     * composes.
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

    // Confirm the failure landed as a non-composable composition for the failing flag only
    const compositionsResp = await client.getCompositions({
      fedGraphName: federatedGraphName,
      namespace,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsResp.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsResp.compositions.some((c) => c.featureFlagName === failingFlagName && !c.isComposable)).toBe(
      true,
    );
    expect(compositionsResp.compositions.some((c) => c.featureFlagName === successfulFlagName && !c.isComposable)).toBe(
      false,
    );

    /**
     * Both flags are still in the latest composition. A failed composition does not remove the flag: its router config
     * is not replaced, so the last valid composition keeps being served, and the flag remains attached and enabled.
     */
    resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName,
      namespace,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureFlags).toHaveLength(2);
    expect(resp.featureFlags.map((f) => f.name).sort()).toStrictEqual(
      [successfulFlagName, failingFlagName].sort((a, b) => a.localeCompare(b)),
    );
  });

  test('Should return ERR_NOT_FOUND for non-existent federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const resp = await client.getFeatureFlagsInLatestCompositionByFederatedGraph({
      federatedGraphName: 'non-existent-graph',
      namespace: 'default',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });
});
