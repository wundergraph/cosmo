import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createNamespace,
  createSubgraph,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Create feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature subgraph can be created', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created without a base graph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A feature subgraph requires a base subgraph.');

    await server.close();
  });

  test('that an error is returned if the base graph does not exist in the same namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const namespace = genID('namespace').toLowerCase();
    await createNamespace(client, namespace);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      namespace,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponse.response?.details).toBe(
      `Base subgraph "${subgraphName}" does not exist in the namespace "${namespace}".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created without a routing URL', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    const createFederatedSubgraphResp = await client.createFederatedSubgraph({
      name: subgraphName,
      isFeatureSubgraph: true,
    });

    expect(createFederatedSubgraphResp.response?.code).toBe(EnumStatusCode.ERR);
    expect(createFederatedSubgraphResp.response?.details).toBe('A non-Event-Driven Graph must define a routing URL');

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as its base subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');

    await createSubgraph(client, subgraphName, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: subgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphName,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponse.response?.details).toBe(
      `A subgraph with the name "${subgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as another subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const subgraphNameTwo = genID('subgraphTwo');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);
    await createSubgraph(client, subgraphNameTwo, DEFAULT_SUBGRAPH_URL_TWO);

    const featureSubgraphResponse = await client.createFederatedSubgraph({
      name: subgraphNameTwo,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });

    expect(featureSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponse.response?.details).toBe(
      `A subgraph with the name "${subgraphNameTwo}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that an error is returned if a feature subgraph is created with the same name as another feature subgraph', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const featureSubgraphResponseTwo = await client.createFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
    });
    expect(featureSubgraphResponseTwo.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);
    expect(featureSubgraphResponseTwo.response?.details).toBe(
      `A feature subgraph with the name "${featureSubgraphName}" already exists in the namespace "default".`,
    );

    await server.close();
  });

  test('that a feature subgraph can be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.OK);

    const getFeatureSubgraphResponse = await client.getSubgraphByName({
      name: featureSubgraphName,
    });

    expect(getFeatureSubgraphResponse.response?.code).toBe(EnumStatusCode.OK);
    expect(getFeatureSubgraphResponse.graph?.name).toBe(featureSubgraphName);
    expect(getFeatureSubgraphResponse.graph?.routingURL).toBe(DEFAULT_SUBGRAPH_URL_TWO);
    expect(getFeatureSubgraphResponse.graph?.isFeatureSubgraph).toBe(true);

    await server.close();
  });

  test('that a feature subgraph with out base subgraph cannot be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      routingUrl: DEFAULT_SUBGRAPH_URL_TWO,
      isFeatureSubgraph: true,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(featureSubgraphResponseOne.response?.details).toBe(
      `Feature Subgraph ${featureSubgraphName} not found. If intended to create and publish, please pass the name of the base subgraph with --subgraph option.`,
    );

    await server.close();
  });

  test('that a feature subgraph with out a valid routing url cannot be created and published with one command.', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphNameOne = genID('subgraphOne');
    const featureSubgraphName = genID('featureSubgraphOne');

    await createSubgraph(client, subgraphNameOne, DEFAULT_SUBGRAPH_URL_ONE);

    const featureSubgraphResponseOne = await client.publishFederatedSubgraph({
      name: featureSubgraphName,
      isFeatureSubgraph: true,
      baseSubgraphName: subgraphNameOne,
      schema: 'type Query { hello: String }',
    });
    expect(featureSubgraphResponseOne.response?.code).toBe(EnumStatusCode.ERR);
    expect(featureSubgraphResponseOne.response?.details).toBe(
      `A valid, non-empty routing URL is required to create and publish a feature subgraph.`,
    );

    await server.close();
  });
});
