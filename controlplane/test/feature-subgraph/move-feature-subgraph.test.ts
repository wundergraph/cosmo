import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID } from '../../src/core/test-util.js';
import {
  createBaseAndFeatureSubgraph,
  createNamespace,
  createSubgraph, DEFAULT_NAMESPACE,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('Move feature subgraph tests', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that a feature subgraph cannot be moved', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('featureSubgraph');

    await createBaseAndFeatureSubgraph(
      client,
      subgraphName,
      featureSubgraphName,
      DEFAULT_SUBGRAPH_URL_ONE,
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const moveSubgraphResponse = await client.moveSubgraph({
      name: featureSubgraphName,
      namespace: DEFAULT_NAMESPACE,
      newNamespace: 'prod',
    });
    expect(moveSubgraphResponse.response?.code).toBe(EnumStatusCode.ERR);
    expect(moveSubgraphResponse.response?.details).toBe('Feature subgraphs cannot be moved.');

    await server.close();
  });
});
