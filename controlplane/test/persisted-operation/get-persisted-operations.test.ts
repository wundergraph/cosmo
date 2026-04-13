import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createFederatedGraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('GetPersistedOperations', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return empty list when no persisted operations exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const response = await client.getPersistedOperations({
      federatedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      clientId: randomUUID(),
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toEqual([]);
  });

  test('Should fail when federated graph does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const response = await client.getPersistedOperations({
      federatedGraphName: 'nonexistent',
      namespace: DEFAULT_NAMESPACE,
      clientId: randomUUID(),
    });

    expect(response.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(response.response?.details).toContain("Federated graph 'nonexistent' does not exist");
    expect(response.operations).toEqual([]);
  });

  test('Should return published persisted operations', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: 'http://localhost:4001',
    });

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String! }',
    });

    const graphName = genID('fedgraph');
    await client.createFederatedGraph({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    const clientName = 'test-client';
    const operationId = genID('op');
    const publishResp = await client.publishPersistedOperations({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      clientName,
      operations: [{ id: operationId, contents: 'query { hello }' }],
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const clients = await client.getClients({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(clients.response?.code).toBe(EnumStatusCode.OK);
    expect(clients.clients).toHaveLength(1);

    const response = await client.getPersistedOperations({
      federatedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      clientId: clients.clients[0].id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(1);
    expect(response.operations[0].id).toBe(operationId);
  });

  test('Should return multiple published persisted operations', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const subgraphName = genID('subgraph');
    const label = genUniqueLabel();

    await client.createFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      labels: [label],
      routingUrl: 'http://localhost:4001',
    });

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String!, hi: String! }',
    });

    const graphName = genID('fedgraph');
    await client.createFederatedGraph({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
      routingUrl: 'http://localhost:8080',
      labelMatchers: [joinLabel(label)],
    });

    const clientName = 'test-client';
    const op1Id = genID('op1');
    const op2Id = genID('op2');
    const publishResp = await client.publishPersistedOperations({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      clientName,
      operations: [
        { id: op1Id, contents: 'query { hello }' },
        { id: op2Id, contents: 'query { hi }' },
      ],
    });
    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);

    const clients = await client.getClients({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(clients.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.getPersistedOperations({
      federatedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      clientId: clients.clients[0].id,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.operations).toHaveLength(2);
    const operationIds = response.operations.map((op) => op.id);
    expect(operationIds).toContain(op1Id);
    expect(operationIds).toContain(op2Id);
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to get persisted operations',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const getGraphResponse = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [getGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getPersistedOperations({
        federatedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
        clientId: randomUUID(),
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );
});
