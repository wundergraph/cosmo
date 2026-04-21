import fs from 'node:fs';
import { join } from 'node:path';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('GetFeatureSubgraphsByFederatedGraph', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return feature subgraphs for a federated graph', async (testContext) => {
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

    const resp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 10,
      offset: 0,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureSubgraphs.length).toBeGreaterThanOrEqual(1);
    expect(resp.featureSubgraphs.some((s) => s.name === 'users-feature')).toBe(true);
    expect(resp.totalCount).toBeGreaterThanOrEqual(1);
  });

  test('Should paginate feature subgraphs', async (testContext) => {
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

    await createAndPublishSubgraph(
      client,
      'products',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products.graphql')).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'products-feature',
      'products',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-feature.graphql')).toString(),
      labels,
      'http://localhost:4102',
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, labels, ['users-feature', 'products-feature'], 'default', true);

    // Fetch all
    const allResp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 0,
      offset: 0,
    });

    expect(allResp.response?.code).toBe(EnumStatusCode.OK);
    expect(allResp.totalCount).toBe(2);
    expect(allResp.featureSubgraphs).toHaveLength(2);

    // Fetch page 1
    const page1 = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 1,
      offset: 0,
    });

    expect(page1.response?.code).toBe(EnumStatusCode.OK);
    expect(page1.featureSubgraphs).toHaveLength(1);
    expect(page1.totalCount).toBe(2);

    // Fetch page 2
    const page2 = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 1,
      offset: 1,
    });

    expect(page2.response?.code).toBe(EnumStatusCode.OK);
    expect(page2.featureSubgraphs).toHaveLength(1);
    expect(page2.totalCount).toBe(2);

    // Pages return different subgraphs
    expect(page1.featureSubgraphs[0].name).not.toBe(page2.featureSubgraphs[0].name);
  });

  test('Should filter feature subgraphs by search query', async (testContext) => {
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

    await createAndPublishSubgraph(
      client,
      'products',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products.graphql')).toString(),
      labels,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'products-feature',
      'products',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-feature.graphql')).toString(),
      labels,
      'http://localhost:4102',
    );

    const federatedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabels, DEFAULT_ROUTER_URL);

    const flagName = genID('flag');
    await createFeatureFlag(client, flagName, labels, ['users-feature', 'products-feature'], 'default', true);

    // Search for "users"
    const resp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 10,
      offset: 0,
      query: 'users',
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureSubgraphs).toHaveLength(1);
    expect(resp.featureSubgraphs[0].name).toBe('users-feature');
    expect(resp.totalCount).toBe(1);
  });

  test('Should return empty list when no feature subgraphs exist', async (testContext) => {
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

    const resp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 10,
      offset: 0,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.featureSubgraphs).toHaveLength(0);
    expect(resp.totalCount).toBe(0);
  });

  test('Should return ERR_NOT_FOUND for non-existent federated graph', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const resp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName: 'non-existent-graph',
      namespace: 'default',
      limit: 10,
      offset: 0,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('Should only return feature subgraphs from feature flags matching the graph labels', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labelsA = [genUniqueLabel('teamA')];
    const labelsB = [genUniqueLabel('teamB')];
    const federatedGraphName = genID('fedGraph');

    await createAndPublishSubgraph(
      client,
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
      labelsA,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature',
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labelsA,
      'http://localhost:4101',
    );

    const federatedGraphLabelsA = labelsA.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabelsA, DEFAULT_ROUTER_URL);

    // Feature flag with label A (matches the graph)
    const matchingFlag = genID('matchingFlag');
    await createFeatureFlag(client, matchingFlag, labelsA, ['users-feature'], 'default', true);

    // Feature flag with label B (does NOT match the graph)
    const nonMatchingFlag = genID('nonMatchingFlag');
    await createFeatureFlag(client, nonMatchingFlag, labelsB, ['users-feature'], 'default', true);

    const resp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 10,
      offset: 0,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    // users-feature should appear because the matching flag (label A) includes it
    expect(resp.featureSubgraphs.some((s) => s.name === 'users-feature')).toBe(true);
  });

  test('Should exclude feature subgraphs whose base subgraph is in the graph but feature flag does not match', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labelsA = [genUniqueLabel('teamA')];
    const labelsB = [genUniqueLabel('teamB')];
    const federatedGraphName = genID('fedGraph');

    // Create base subgraph "users" with label A — this will be part of the fed graph
    await createAndPublishSubgraph(
      client,
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users.graphql')).toString(),
      labelsA,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    // Create two feature subgraphs, both based on "users"
    await createThenPublishFeatureSubgraph(
      client,
      'users-feature-a',
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labelsA,
      'http://localhost:4101',
    );

    await createThenPublishFeatureSubgraph(
      client,
      'users-feature-b',
      'users',
      'default',
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labelsB,
      'http://localhost:4102',
    );

    // Create federated graph with label A only
    const federatedGraphLabelsA = labelsA.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, federatedGraphName, 'default', federatedGraphLabelsA, DEFAULT_ROUTER_URL);

    // Feature flag with label A — matches the fed graph
    // Contains users-feature-a
    const matchingFlag = genID('matchingFlag');
    await createFeatureFlag(client, matchingFlag, labelsA, ['users-feature-a'], 'default', true);

    // Feature flag with label B — does NOT match the fed graph
    // Contains users-feature-b (whose base subgraph "users" IS in the fed graph, but the flag isn't)
    const nonMatchingFlag = genID('nonMatchingFlag');
    await createFeatureFlag(client, nonMatchingFlag, labelsB, ['users-feature-b'], 'default', true);

    const resp = await client.getFeatureSubgraphsByFederatedGraph({
      federatedGraphName,
      namespace: 'default',
      limit: 10,
      offset: 0,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    // users-feature-a should be included — its flag (label A) matches the graph
    expect(resp.featureSubgraphs.some((s) => s.name === 'users-feature-a')).toBe(true);
    // users-feature-b should NOT be included — its base subgraph "users" is in the graph,
    // but its feature flag (label B) does not match the graph's label matchers
    expect(resp.featureSubgraphs.some((s) => s.name === 'users-feature-b')).toBe(false);
  });
});
