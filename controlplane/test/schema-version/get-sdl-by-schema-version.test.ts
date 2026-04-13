import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createAPIKeyTestRBACEvaluator,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { DEFAULT_NAMESPACE, createFederatedGraph, createSubgraph, createThenPublishSubgraph, SetupTest } from '../test-util.js';

let dbname = '';

describe('GetSdlBySchemaVersion', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('Should return SDL for a valid schema version', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createSubgraph(client, subgraphName, 'http://localhost:4001');

    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: 'type Query { hello: String }',
    });

    const getGraphResponse = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    // Get the composition to find the schemaVersionId
    const compositions = await client.getCompositions({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: new Date(Date.now() - 86_400_000).toISOString(),
      endDate: new Date().toISOString(),
      limit: 1,
      offset: 0,
    });
    expect(compositions.response?.code).toBe(EnumStatusCode.OK);
    expect(compositions.compositions.length).toBe(1);
    const schemaVersionId = compositions.compositions[0].schemaVersionId;

    const response = await client.getSdlBySchemaVersion({
      targetId: getGraphResponse.graph!.targetId,
      schemaVersionId,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.sdl).toBe(`schema {\n  query: Query\n}\n\ntype Query {\n  hello: String\n}`);
  });

  test('Should return empty SDL when the version does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const getGraphResponse = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const response = await client.getSdlBySchemaVersion({
      targetId: getGraphResponse.graph!.targetId,
      schemaVersionId: '00000000-0000-0000-0000-000000000000',
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
    expect(response.sdl).toBe('');
    expect(response.clientSchema).toBe('');
  });

  test.each(['organization-admin', 'organization-developer', 'organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should be able to call getSdlBySchemaVersion',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedgraph');
      await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

      const subgraphName = genID('subgraph');
      await createThenPublishSubgraph(
        client,
        subgraphName,
        DEFAULT_NAMESPACE,
        'type Query { hello: String }',
        [],
        'http://localhost:4001',
      );

      const getGraphResponse = await client.getFederatedGraphByName({
        name: graphName,
        namespace: DEFAULT_NAMESPACE,
      });
      expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

      const compositions = await client.getCompositions({
        fedGraphName: graphName,
        namespace: DEFAULT_NAMESPACE,
        startDate: new Date(Date.now() - 86_400_000).toISOString(),
        endDate: new Date().toISOString(),
        limit: 1,
        offset: 0,
      });
      expect(compositions.response?.code).toBe(EnumStatusCode.OK);
      expect(compositions.compositions.length).toBe(1);
      const schemaVersionId = compositions.compositions[0].schemaVersionId;

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({
            role,
            resources: [getGraphResponse.graph!.targetId],
          }),
        ),
      });

      const response = await client.getSdlBySchemaVersion({
        targetId: getGraphResponse.graph!.targetId,
        schemaVersionId,
      });

      expect(response.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test('Should be able to call getSdlBySchemaVersion when using legacy API key', async (testContext) => {
    const { client, server, authenticator, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const graphName = genID('fedgraph');
    await createFederatedGraph(client, graphName, DEFAULT_NAMESPACE, [], 'http://localhost:8080');

    const subgraphName = genID('subgraph');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      'type Query { hello: String }',
      [],
      'http://localhost:4001',
    );

    const getGraphResponse = await client.getFederatedGraphByName({
      name: graphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(getGraphResponse.response?.code).toBe(EnumStatusCode.OK);

    const compositions = await client.getCompositions({
      fedGraphName: graphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: new Date(Date.now() - 86_400_000).toISOString(),
      endDate: new Date().toISOString(),
      limit: 1,
      offset: 0,
    });
    expect(compositions.response?.code).toBe(EnumStatusCode.OK);
    expect(compositions.compositions.length).toBe(1);
    const schemaVersionId = compositions.compositions[0].schemaVersionId;

    authenticator.changeUserWithSuppliedContext({
      ...users.adminAliceCompanyA,
      rbac: createAPIKeyTestRBACEvaluator(),
    });

    const response = await client.getSdlBySchemaVersion({
      targetId: getGraphResponse.graph!.targetId,
      schemaVersionId,
    });

    expect(response.response?.code).toBe(EnumStatusCode.OK);
  });
});
