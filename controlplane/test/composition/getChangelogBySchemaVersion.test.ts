import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { joinLabel } from '@wundergraph/cosmo-shared';
import { addMinutes, formatISO, subDays } from 'date-fns';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  createFederatedGraph,
  createNamespace,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  SetupTest,
} from '../test-util.js';

let dbname = '';

describe('getChangelogBySchemaVersion', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('should return changelog for a valid schema version', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const subgraphSchemaSDL = 'type Query { hello: String! }';

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');
    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      subgraphSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    // Get the graph to find schema version
    const graphRes = await client.getFederatedGraphByName({
      name: fedGraphName,
      namespace: DEFAULT_NAMESPACE,
    });
    expect(graphRes.response?.code).toBe(EnumStatusCode.OK);
    expect(graphRes.graph?.lastUpdatedAt).toBeDefined();

    // Get compositions to find schema version
    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions.length).toBe(1);

    const schemaVersionId = compositionsRes.compositions[0].schemaVersionId;

    const changelogRes = await client.getChangelogBySchemaVersion({
      schemaVersionId,
    });

    expect(changelogRes.response?.code).toBe(EnumStatusCode.OK);
    expect(changelogRes.changelog).toBeDefined();
    expect(changelogRes.changelog?.schemaVersionId).toBe(schemaVersionId);
    expect(changelogRes.changelog?.compositionId).toBeDefined();
    expect(changelogRes.changelog?.changelogs).toBeDefined();

    await server.close();
  });

  test('should return changelog with changes when schema is updated', async () => {
    const { client, server } = await SetupTest({ dbname });

    const subgraphName = genID('subgraph');
    const fedGraphName = genID('fedGraph');
    const label = genUniqueLabel('label');
    const initialSchemaSDL = 'type Query { hello: String! }';

    await createThenPublishSubgraph(
      client,
      subgraphName,
      DEFAULT_NAMESPACE,
      initialSchemaSDL,
      [label],
      'http://localhost:8082',
    );

    await createFederatedGraph(client, fedGraphName, DEFAULT_NAMESPACE, [joinLabel(label)], 'http://localhost:8080');

    // Publish an update to create changes
    const updatedSchemaSDL = 'type Query { hello: String! world: String! }';
    await client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: updatedSchemaSDL,
    });

    // Get the latest composition
    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace: DEFAULT_NAMESPACE,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);
    expect(compositionsRes.compositions.length).toBe(2);

    const latestSchemaVersionId = compositionsRes.compositions[0].schemaVersionId;

    const changelogRes = await client.getChangelogBySchemaVersion({
      schemaVersionId: latestSchemaVersionId,
    });

    expect(changelogRes.response?.code).toBe(EnumStatusCode.OK);
    expect(changelogRes.changelog).toBeDefined();
    expect(changelogRes.changelog?.changelogs).toBeDefined();
    expect(changelogRes.changelog?.changelogs.length).toBe(1);

    await server.close();
  });

  test('should return not found error for non-existent schema version', async () => {
    const { client, server } = await SetupTest({ dbname });

    const changelogRes = await client.getChangelogBySchemaVersion({
      schemaVersionId: randomUUID(),
    });

    expect(changelogRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(changelogRes.response?.details).toBe('Could not find composition linked to the changelog');

    await server.close();
  });

  test('should not allow access to changelog from different organization', async () => {
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
    expect(compositionsRes.compositions.length).toBeGreaterThan(0);

    const schemaVersionId = compositionsRes.compositions[0].schemaVersionId;

    // Switch to Company B user
    if (!users.adminJimCompanyB) {
      throw new Error('adminJimCompanyB user not found');
    }
    authenticator.changeUserWithSuppliedContext(users.adminJimCompanyB);

    // Try to access Company A's changelog
    const changelogRes = await client.getChangelogBySchemaVersion({
      schemaVersionId,
    });

    // Should return not found (since it filters by organization)
    expect(changelogRes.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(changelogRes.response?.details).toBe('Could not find composition linked to the changelog');

    await server.close();
  });

  test('should work with custom namespace', async () => {
    const { client, server } = await SetupTest({ dbname });

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

    const compositionsRes = await client.getCompositions({
      fedGraphName,
      namespace,
      startDate: formatISO(subDays(new Date(), 1)),
      endDate: formatISO(addMinutes(new Date(), 1)),
    });
    expect(compositionsRes.response?.code).toBe(EnumStatusCode.OK);

    const schemaVersionId = compositionsRes.compositions[0].schemaVersionId;

    const changelogRes = await client.getChangelogBySchemaVersion({
      schemaVersionId,
    });

    expect(changelogRes.response?.code).toBe(EnumStatusCode.OK);
    expect(changelogRes.changelog).toBeDefined();
    expect(changelogRes.changelog?.schemaVersionId).toBe(schemaVersionId);

    await server.close();
  });
});
