import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { createFederatedGraph, createThenPublishSubgraph, DEFAULT_NAMESPACE, SetupTest } from '../test-util.js';

let dbname = '';

describe('getCompositionDetails', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('should return composition details for a valid composition', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions.length).toBe(1);

    const compositionId = compositionsRes.compositions[0].id;

    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(detailsRes.composition).toBeDefined();
    expect(detailsRes.composition?.id).toBe(compositionId);
    expect(detailsRes.compositionSubgraphs).toBeDefined();
    expect(detailsRes.compositionSubgraphs.length).toBe(1);
    expect(detailsRes.changeCounts).toBeDefined();

    await server.close();
  });

  test('should return not found error for non-existent composition', async () => {
    const { client, server } = await SetupTest({ dbname });

    const nonExistentId = randomUUID();
    const detailsRes = await client.getCompositionDetails({
      compositionId: nonExistentId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(detailsRes.response?.details).toBe(`Graph composition with '${nonExistentId}' does not exist`);

    await server.close();
  });

  test('should return not found error for non-existent namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

    const detailsRes = await client.getCompositionDetails({
      compositionId: randomUUID(),
      namespace: 'non-existent-namespace',
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(detailsRes.response?.details).toBe("Namespace 'non-existent-namespace' not found");

    await server.close();
  });

  test('should not allow access to compositions from different organization', async () => {
    const { client, server, authenticator, users } = await SetupTest({
      dbname,
      enableMultiUsers: true,
    });

    // Create a composition as Company A
    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions.length).toBe(1);

    const compositionId = compositionsRes.compositions[0].id;

    // Switch to Company B user
    if (!users.adminJimCompanyB) {
      throw new Error('adminJimCompanyB user not found');
    }
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB);

    // Try to access Company A's composition
    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    // Should return not found (since it filters by organization)
    expect(detailsRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

    await server.close();
  });

  test('should include composition subgraphs information', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraph1Name = genID('subgraph1');
    const subgraph2Name = genID('subgraph2');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    // Create multiple subgraphs
    await createThenPublishSubgraph(
      client,
      subgraph1Name,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createThenPublishSubgraph(
      client,
      subgraph2Name,
      DEFAULT_NAMESPACE,
      'type Query { world: String! }',
      [label],
      'http://localhost:8083',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);

    const compositionId = compositionsRes.compositions[0].id;

    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(detailsRes.compositionSubgraphs).toBeDefined();
    expect(detailsRes.compositionSubgraphs.length).toBe(2);

    // Verify subgraph information is present
    const subgraphNames = detailsRes.compositionSubgraphs.map((sg) => sg.name);
    expect(subgraphNames).toContain(subgraph1Name);
    expect(subgraphNames).toContain(subgraph2Name);

    await server.close();
  });

  test('should return empty feature flag compositions when none exist', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);

    const compositionId = compositionsRes.compositions[0].id;

    const detailsRes = await client.getCompositionDetails({
      compositionId,
      namespace: DEFAULT_NAMESPACE,
    });

    expect(detailsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(detailsRes.featureFlagCompositions).toBeDefined();
    expect(detailsRes.featureFlagCompositions).toEqual([]);

    await server.close();
  });
});
