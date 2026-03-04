import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { ROUTER_COMPATIBILITY_VERSION_ONE } from '@wundergraph/composition';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  afterAllSetup,
  beforeAllSetup, createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel
} from '../../src/core/test-util.js';
import {
  assertNumberOfCompositions,
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  SetupTest
} from '../test-util.js';

describe('federated-graph version tests', () => {
  let chClient: ClickHouseClient;
  let dbname = '';

  vi.mock('../src/core/clickhouse/index.js', () => {
    const ClickHouseClient = vi.fn();
    ClickHouseClient.prototype.queryPromise = vi.fn();

    return { ClickHouseClient };
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('get tests', () => {
    test.each([
      'organization-admin',
      'organization-developer',
      'organization-viewer',
      'graph-admin',
      'graph-viewer',
    ])('%s should be able to read the version of a federated graph', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);
      expect(response.graph).toBeDefined();
      expect(response.graph!.routerCompatibilityVersion).toStrictEqual(ROUTER_COMPATIBILITY_VERSION_ONE);

      await server.close();
    });

    test.each([
      'graph-admin',
      'graph-viewer',
    ])('%s should be able to read the version of a federated graph of allowed namespaces', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      const getNamespaceResponse = await client.getNamespace({ name: namespace });
      expect(getNamespaceResponse.response?.code);

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({
          role,
          namespaces: [getNamespaceResponse.namespace!.id],
        })),
      });

      let response = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);
      expect(response.graph).toBeDefined();
      expect(response.graph!.routerCompatibilityVersion).toStrictEqual(ROUTER_COMPATIBILITY_VERSION_ONE);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role, namespaces: [randomUUID()], })),
      });

      response = await client.getFederatedGraphByName({ name: fedGraphName, namespace, });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test.each([
      'organization-apikey-manager',
      'namespace-admin',
      'namespace-viewer',
      'subgraph-admin',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s not should be able to read the version of a federated graph', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });

      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });
  });

  describe('set tests', () => {
    test('that an error is returned if an invalid router compatibility version integer is provided', async () => {
      const { client, blobStorage, server, } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
      const federatedGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      const response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: '9999',
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(response.response!.details).toBe('Invalid router compatibility version "9999".');
      expect(response.previousVersion).toBe('1');
      expect(response.newVersion).toBe('1');
      expect(response.compositionErrors).toHaveLength(0);
      expect(response.compositionWarnings).toHaveLength(0);
      expect(response.deploymentErrors).toHaveLength(0);

      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      await server.close();
    });

    test('that an error is returned if an invalid router compatibility version string is provided', async () => {
      const { client, blobStorage, server, } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
      const federatedGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      const response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: 'hello',
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(response.response!.details).toBe('Invalid router compatibility version "hello".');
      expect(response.previousVersion).toBe('1');
      expect(response.newVersion).toBe('1');
      expect(response.compositionErrors).toHaveLength(0);
      expect(response.compositionWarnings).toHaveLength(0);
      expect(response.deploymentErrors).toHaveLength(0);

      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      await server.close();
    });

    test.each([
      'organization-admin',
      'organization-developer',
      'graph-admin',
    ])('%s should be able to update the router compatibility version', async (role) => {
      const { client, blobStorage, server, authenticator, users } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
      const federatedGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);

      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      await server.close();
    });

    test('graph-admin should be able to update the router compatibility version on allowed namespace', async () => {
      const { client, blobStorage, server, authenticator, users } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      const getNamespaceResponse = await client.getNamespace({ name: namespace });
      expect(getNamespaceResponse.response?.code).toBe(EnumStatusCode.OK);

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
      const federatedGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({
          role: 'graph-admin',
          namespaces: [getNamespaceResponse.namespace!.id],
        })),
      });

      let response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);

      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({
          role: 'graph-admin',
          namespaces: [randomUUID()],
        })),
      });

      response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test.each([
      'organization-apikey-manager',
      'organization-viewer',
      'namespace-admin',
      'namespace-viewer',
      'graph-viewer',
      'subgraph-admin',
      'subgraph-publisher',
      'subgraph-viewer',
    ])('%s should not be able to update the router compatibility version', async (role) => {
      const { client, blobStorage, server, authenticator, users } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
      const federatedGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      await server.close();
    });

    test('that setting the same router compatibility version is idempotent and does not trigger further compositions', async () => {
      const { client, blobStorage, server, } = await SetupTest({ dbname, chClient });
      const namespace = genID('namespace').toLowerCase();
      await createNamespace(client, namespace);
      const subgraphName = genID('subgraph');
      const fedGraphName = genID('fedGraph');
      const label = genUniqueLabel('label');
      const subgraphSchemaSDL = 'type Query { hello: String! }';

      await createThenPublishSubgraph(
        client,
        subgraphName,
        namespace,
        subgraphSchemaSDL,
        [label],
        'http://localhost:8082',
      );

      await createFederatedGraph(client, fedGraphName, namespace, [joinLabel(label)], 'http://localhost:8080');
      const federatedGraphResponse = await client.getFederatedGraphByName({
        name: fedGraphName,
        namespace,
      });
      expect(blobStorage.keys()).toHaveLength(1);
      const baseGraphKey = blobStorage.keys()[0];
      expect(baseGraphKey).toContain(`${federatedGraphResponse.graph!.id}/routerconfigs/latest.json`);
      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      const response = await client.setGraphRouterCompatibilityVersion({
        name: fedGraphName,
        namespace,
        version: ROUTER_COMPATIBILITY_VERSION_ONE,
      });
      expect(response.response).toBeDefined();
      expect(response.response!.code).toBe(EnumStatusCode.OK);
      expect(response.response!.details).toBe('The router compatibility version is already set to "1".');
      expect(response.previousVersion).toBe('1');
      expect(response.newVersion).toBe('1');
      expect(response.compositionErrors).toHaveLength(0);
      expect(response.compositionWarnings).toHaveLength(0);
      expect(response.deploymentErrors).toHaveLength(0);

      await assertNumberOfCompositions(client, fedGraphName, 1, namespace);

      await server.close();
    });
  });
});