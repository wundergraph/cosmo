import { join } from 'node:path';
import fs from 'node:fs';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { formatISO } from 'date-fns';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import {
  createAndPublishSubgraph,
  createBaseAndFeatureGraph,
  createFederatedGraph,
  createThenPublishFeatureGraph,
  SetupTest,
  tomorrowDate,
  yearStartDate,
} from './test-util.js';

let dbname = '';

describe('Feature flag integration tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature flag can be disabled and re-enabled', async () => {
    const { client, server, blobStorage } = await SetupTest({ dbname });

    const namespace = 'default';
    const labels = [{ key: 'team', value: 'A' }];
    const users = 'users';
    await createAndPublishSubgraph(
      client,
      users,
      namespace,
      fs.readFileSync(join(process.cwd(), `test/test-data/feature-flags/users.graphql`)).toString(),
      labels,
      'http://localhost:4001',
    );
    const products = 'products';
    await createAndPublishSubgraph(
      client,
      products,
      namespace,
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products.graphql')).toString(),
      labels,
      'http://localhost:4002',
    );
    const usersFeature = 'users-feature';
    await createThenPublishFeatureGraph(
      client,
      usersFeature,
      users,
      namespace,
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/users-feature.graphql')).toString(),
      labels,
      'http://localhost:4003',
    );
    const productsFeature = 'products-feature';
    await createThenPublishFeatureGraph(
      client,
      productsFeature,
      products,
      namespace,
      fs.readFileSync(join(process.cwd(), 'test/test-data/feature-flags/products-feature.graphql')).toString(),
      labels,
      'http://localhost:4004',
    );

    const federatedGraphName = genID('federatedGraphName');
    await createFederatedGraph(
      client,
      federatedGraphName,
      namespace,
      ['team=A'],
      'http://localhost:3002',
    );
    const federatedGraph = await client.getFederatedGraphByName({
      name: federatedGraphName,
    });
    expect(blobStorage.keys()).toHaveLength(1);
    const key = blobStorage.keys()[0];
    expect(key).toContain(federatedGraph.graph!.id);
    const baseGraphBlob = await blobStorage.getObject({ key });
    const routerExeConfig =  await baseGraphBlob.stream.getReader().read()
      .then((result) => JSON.parse(result.value.toString()));
    expect(routerExeConfig.featureFlagConfigs).toBeUndefined();
    const baseGraphCompositionResponse = await client.getCompositions({
      fedGraphName: federatedGraphName,
      startDate: formatISO(yearStartDate),
      endDate: formatISO(tomorrowDate),
    });
    expect(baseGraphCompositionResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(baseGraphCompositionResponse.compositions).toHaveLength(1);
    const flagName = 'flag';
    const createFeatureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [usersFeature, productsFeature],
      labels,
    });
    expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);
    const featureFlagCompositionResponse = await client.getCompositions({
      fedGraphName: federatedGraphName,
      startDate: formatISO(yearStartDate),
      endDate: formatISO(tomorrowDate),
    });
    expect(featureFlagCompositionResponse.response?.code).toBe(EnumStatusCode.OK);
    // TODO
    // expect(compositionsResponseTwo.compositions).toHaveLength(2);

    expect(blobStorage.keys()).toHaveLength(1);
    const ffBlob = await blobStorage.getObject({ key });
    const routerExecutionConfigWithFF =  await ffBlob.stream.getReader().read()
      .then((result) => JSON.parse(result.value.toString()));
    expect(routerExecutionConfigWithFF.featureFlagConfigs).toBeDefined();

    const disableFeatureFlagResponse = await client.enableFeatureFlag({
      featureFlagName: flagName,
      namespace,
      enabled: false,
    });
    expect(disableFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const disableFfBlob = await blobStorage.getObject({ key });
    const routerExecutionConfigWithDisabledFF =  await disableFfBlob.stream.getReader().read()
      .then((result) => JSON.parse(result.value.toString()));
    expect(routerExecutionConfigWithDisabledFF.featureFlagConfigs).toBeUndefined();

    const enableFeatureFlagResponse = await client.enableFeatureFlag({
      featureFlagName: flagName,
      namespace,
      enabled: true,
    });
    expect(enableFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const enableFfBlob = await blobStorage.getObject({ key });
    const routerExecutionConfigWithEnabledFF =  await enableFfBlob.stream.getReader().read()
      .then((result) => JSON.parse(result.value.toString()));
    expect(routerExecutionConfigWithEnabledFF.featureFlagConfigs).toBeDefined();

    await server.close();
  });

  test('that a feature flag can be updated with another feature graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureGraphName = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphName, featureGraphName, 'http://localhost:4001', 'http://localhost:4002');

    const flagName = genID('flag');

    const createFeatureFlagResponse = await client.createFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [featureGraphName],
    });

    expect(createFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    const subgraphNameTwo = genID('subgraph');
    const featureGraphNameTwo = genID('featureGraph');

    await createBaseAndFeatureGraph(client, subgraphNameTwo, featureGraphNameTwo, 'http://localhost:4001', 'http://localhost:4002');

    const updateFeatureFlagResponse = await client.updateFeatureFlag({
      featureFlagName: flagName,
      featureGraphNames: [featureGraphName, featureGraphNameTwo],
    });

    expect(updateFeatureFlagResponse.response?.code).toBe(EnumStatusCode.OK);

    await server.close();
  });
});
