import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  assertNumberOfCompositions,
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  SetupTest
} from '../test-util.js';

describe('monograph version tests', () => {
  let chClient: ClickHouseClient;
  let dbname = '';

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('get tests', () => {
    test('that the router compatibility version of a monograph is returned', async () => {
      const { client } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const monographName = genID('monograph');
      const schemaSDL = 'type Query { hello: String! }';

      const createMonographResponse = await client.createMonograph({
        name: monographName,
        namespace,
        graphUrl: 'http://localhost:4000',
        routingUrl: 'http://localhost:3002',
      });
      expect(createMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const publishMonographResponse = await client.publishMonograph({
        name: monographName,
        namespace,
        schema: schemaSDL,
      });
      expect(publishMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const response = await client.getFederatedGraphByName({
        name: monographName,
        namespace,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);
      expect(response.graph).toBeDefined();
      expect(response.graph!.routerCompatibilityVersion).toStrictEqual(1);
    });
  });

  describe('set tests', () => {
    test('that an error is returned if an invalid router compatibility version is provided #1', async () => {
      const { client, blobStorage, } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const monographName = genID('monograph');
      const schemaSDL = 'type Query { hello: String! }';

      const createMonographResponse = await client.createMonograph({
        name: monographName,
        namespace,
        graphUrl: 'http://localhost:4000',
        routingUrl: 'http://localhost:3002',
      });
      expect(createMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const publishMonographResponse = await client.publishMonograph({
        name: monographName,
        namespace,
        schema: schemaSDL,
      });
      expect(publishMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const monographResponse = await client.getFederatedGraphByName({
        name: monographName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${monographResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, monographName, 1, namespace);

      const response = await client.setGraphRouterCompatibilityVersion({
        name: monographName,
        namespace,
        version: '9999',
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(response.response!.details).toBe('9999 is not a valid router compatibility version.');
      expect(response.previousVersion).toBe(1);
      expect(response.newVersion).toBe(1);
      expect(response.compositionErrors).toHaveLength(0);
      expect(response.compositionWarnings).toHaveLength(0);
      expect(response.deploymentErrors).toHaveLength(0);

      await assertNumberOfCompositions(client, monographName, 1, namespace);
    });

    test('that an error is returned if an invalid router compatibility version is provided #2', async () => {
      const { client, blobStorage, } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const monographName = genID('monograph');
      const schemaSDL = 'type Query { hello: String! }';

      const createMonographResponse = await client.createMonograph({
        name: monographName,
        namespace,
        graphUrl: 'http://localhost:4000',
        routingUrl: 'http://localhost:3002',
      });
      expect(createMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const publishMonographResponse = await client.publishMonograph({
        name: monographName,
        namespace,
        schema: schemaSDL,
      });
      expect(publishMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const monographResponse = await client.getFederatedGraphByName({
        name: monographName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${monographResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, monographName, 1, namespace);

      const response = await client.setGraphRouterCompatibilityVersion({
        name: monographName,
        namespace,
        version: 'hello',
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(response.response!.details).toBe('hello is not a valid router compatibility version.');
      expect(response.previousVersion).toBe(1);
      expect(response.newVersion).toBe(1);
      expect(response.compositionErrors).toHaveLength(0);
      expect(response.compositionWarnings).toHaveLength(0);
      expect(response.deploymentErrors).toHaveLength(0);

      await assertNumberOfCompositions(client, monographName, 1, namespace);
    });

    test('that setting the same router compatibility version is benign', async () => {
      const { client, blobStorage, } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const monographName = genID('monograph');
      const schemaSDL = 'type Query { hello: String! }';

      const createMonographResponse = await client.createMonograph({
        name: monographName,
        namespace,
        graphUrl: 'http://localhost:4000',
        routingUrl: 'http://localhost:3002',
      });
      expect(createMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const publishMonographResponse = await client.publishMonograph({
        name: monographName,
        namespace,
        schema: schemaSDL,
      });
      expect(publishMonographResponse.response?.code).toBe(EnumStatusCode.OK);

      const monographResponse = await client.getFederatedGraphByName({
        name: monographName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${monographResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, monographName, 1, namespace);

      const response = await client.setGraphRouterCompatibilityVersion({
        name: monographName,
        namespace,
        version: '1',
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);
      expect(response.response!.details).toBe('The router compatibility version is already set to 1.');
      expect(response.previousVersion).toBe(1);
      expect(response.newVersion).toBe(1);
      expect(response.compositionErrors).toHaveLength(0);
      expect(response.compositionWarnings).toHaveLength(0);
      expect(response.deploymentErrors).toHaveLength(0);

      await assertNumberOfCompositions(client, monographName, 1, namespace);
    });
  });
});