import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GraphCollectionSortBy } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
} from '../../src/core/test-util.js';
import { createFederatedGraph, DEFAULT_ROUTER_URL, SetupTest } from '../test-util.js';
import { GraphCollectionsRepository } from '../../src/core/repositories/GraphCollectionsRepository.js';
import { MAX_OPERATION_LENGTH } from '../../src/core/util/graph-collection/validation.js';

let dbname = '';

const QUERY = 'query GetCart { cart { id } }';

/**
 * A syntactically valid document of exactly `length` characters.
 *
 * The field name absorbs the padding, so the size limit can be tested at its
 * boundary without the document also tripping the syntax check - which a naive
 * `'q'.repeat(n)` would.
 */
const documentOfLength = (length: number) => `query Q { ${'a'.repeat(length - 'query Q {  }'.length)} }`;

/** A graph with one empty collection, which is the starting point for most operation tests. */
const setupGraphWithCollection = async () => {
  const { client, server } = await SetupTest({ dbname });

  const graphName = genID('fedGraph');
  await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
  const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!.id;

  const collection = await client.createGraphCollection({
    federatedGraphName: graphName,
    namespace: 'default',
    name: 'Cart',
  });

  return { client, server, federatedGraphId, collectionId: collection.id };
};

describe('Graph Collections', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  describe('Collections', () => {
    test('Creates a collection and lists it back', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart operations',
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);
      expect(created.id).toBeTruthy();

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.response?.code).toBe(EnumStatusCode.OK);
      expect(list.collections).toEqual([
        expect.objectContaining({
          name: 'Cart operations',
          isTeamScoped: false,
          canEdit: true,
          operations: [],
        }),
      ]);
    });

    test('Returns collections and their operations alphabetically, ignoring case', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      // Created out of order, and mixed case, so neither insertion order nor a
      // case-sensitive collation would produce the expected result.
      for (const name of ['zebra', 'Apple', 'mango']) {
        await client.createGraphCollection({ federatedGraphName: graphName, namespace: 'default', name });
      }

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections).toEqual([
        expect.objectContaining({ name: 'Apple' }),
        expect.objectContaining({ name: 'mango' }),
        expect.objectContaining({ name: 'zebra' }),
      ]);

      const collectionId = list.collections.find((c) => c.name === 'mango')!.id;
      for (const name of ['second', 'First', 'third']) {
        await client.createGraphCollectionOperation({ federatedGraphId, collectionId, name, query: QUERY });
      }

      const withOps = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      const mango = withOps.collections.find((c) => c.name === 'mango')!;
      expect(mango.operations).toEqual([
        expect.objectContaining({ name: 'First' }),
        expect.objectContaining({ name: 'second' }),
        expect.objectContaining({ name: 'third' }),
      ]);
    });

    test('Sorts by creation time, newest first, when asked', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

      // Created in an order that alphabetical sorting would not reproduce, so
      // the two orderings cannot be confused for one another.
      for (const name of ['mango', 'Apple', 'zebra']) {
        await client.createGraphCollection({ federatedGraphName: graphName, namespace: 'default', name });
      }

      const listed = await client.getGraphCollections({
        federatedGraphName: graphName,
        namespace: 'default',
        sortBy: GraphCollectionSortBy.GRAPH_COLLECTION_SORT_CREATED_AT,
      });

      expect(listed.collections).toEqual([
        expect.objectContaining({ name: 'zebra' }),
        expect.objectContaining({ name: 'Apple' }),
        expect.objectContaining({ name: 'mango' }),
      ]);
    });

    test('Renaming a collection moves it in the order', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const apple = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Apple',
      });
      await client.createGraphCollection({ federatedGraphName: graphName, namespace: 'default', name: 'mango' });

      await client.renameGraphCollection({ federatedGraphId, id: apple.id, name: 'zebra' });

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections).toEqual([
        expect.objectContaining({ name: 'mango' }),
        expect.objectContaining({ name: 'zebra' }),
      ]);
    });

    test('Rejects an empty collection name', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: '   ',
      });
      expect(created.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
    });

    test('Rejects names that are too long, but allows free-form punctuation', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const tooLong = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'a'.repeat(101),
      });
      expect(tooLong.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);

      const atLimit = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'a'.repeat(100),
      });
      expect(atLimit.response?.code).toBe(EnumStatusCode.OK);

      // These are free-form labels, not identifiers: punctuation, accents and
      // non-Latin scripts must all survive.
      const freeForm = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: "Cart totals (empty) — Ahmet's, 購入",
      });
      expect(freeForm.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Rejects names containing line breaks or control characters', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      for (const name of ['Cart\noperations', 'Cart\toperations', 'Cart\u0000operations']) {
        const res = await client.createGraphCollection({
          federatedGraphName: graphName,
          namespace: 'default',
          name,
        });
        expect(res.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      }
    });

    test('Trims surrounding whitespace before storing', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: '   Cart operations   ',
      });

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections[0].name).toBe('Cart operations');
    });

    test('Renames a collection', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Before',
      });

      const renamed = await client.renameGraphCollection({ federatedGraphId, id: created.id, name: 'After' });
      expect(renamed.response?.code).toBe(EnumStatusCode.OK);

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections[0].name).toBe('After');
    });

    test('Collections are scoped to one graph', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphA = genID('fedGraph');
      const graphB = genID('fedGraph');
      await createFederatedGraph(client, graphA, 'default', [], DEFAULT_ROUTER_URL);
      await createFederatedGraph(client, graphB, 'default', [], DEFAULT_ROUTER_URL);

      await client.createGraphCollection({
        federatedGraphName: graphA,
        namespace: 'default',
        name: 'Only on A',
      });

      const listB = await client.getGraphCollections({ federatedGraphName: graphB, namespace: 'default' });
      expect(listB.response?.code).toBe(EnumStatusCode.OK);
      expect(listB.collections).toEqual([]);
    });

    test('A by-id call naming the wrong graph is a miss, even for a visible collection', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphA = genID('fedGraph');
      const graphB = genID('fedGraph');
      await createFederatedGraph(client, graphA, 'default', [], DEFAULT_ROUTER_URL);
      await createFederatedGraph(client, graphB, 'default', [], DEFAULT_ROUTER_URL);
      const graphBId = (await client.getFederatedGraphByName({ name: graphB, namespace: 'default' })).graph!.id;

      // Team-scoped, same organization, and the caller is an admin: visible by
      // every other rule. Only the graph scoping should reject these.
      const collection = await client.createGraphCollection({
        federatedGraphName: graphA,
        namespace: 'default',
        name: 'Cart',
        teamScoped: true,
      });
      const operation = await client.createGraphCollectionOperation({
        federatedGraphId: (await client.getFederatedGraphByName({ name: graphA, namespace: 'default' })).graph!.id,
        collectionId: collection.id,
        name: 'Totals',
        query: QUERY,
      });
      expect(operation.response?.code).toBe(EnumStatusCode.OK);

      // Naming graph B for a collection that lives in graph A.
      const renamed = await client.renameGraphCollection({
        id: collection.id,
        name: 'Hijacked',
        federatedGraphId: graphBId,
      });
      expect(renamed.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const shared = await client.shareGraphCollection({ id: collection.id, federatedGraphId: graphBId });
      expect(shared.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const fetched = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        id: operation.id,
        federatedGraphId: graphBId,
      });
      expect(fetched.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const deleted = await client.deleteGraphCollection({ id: collection.id, federatedGraphId: graphBId });
      expect(deleted.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      // None of it landed: the collection is untouched under its real graph.
      const list = await client.getGraphCollections({ federatedGraphName: graphA, namespace: 'default' });
      expect(list.collections).toHaveLength(1);
      expect(list.collections[0].name).toBe('Cart');
    });

    // The handlers resolve every row through a graph-scoped lookup, so the
    // identical condition on the writes is unreachable through the RPC surface.
    // It exists for the day that lookup is weakened, which means the only way
    // to exercise it is to call the repository directly.
    test('The write path itself refuses a row from another graph', async () => {
      const { client, server, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphA = genID('fedGraph');
      const graphB = genID('fedGraph');
      await createFederatedGraph(client, graphA, 'default', [], DEFAULT_ROUTER_URL);
      await createFederatedGraph(client, graphB, 'default', [], DEFAULT_ROUTER_URL);
      const graphBId = (await client.getFederatedGraphByName({ name: graphB, namespace: 'default' })).graph!.id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphA,
        namespace: 'default',
        name: 'Cart',
      });

      const repo = new GraphCollectionsRepository(server.log, server.db, users.adminAliceCompanyA.organizationId);

      // Every write, handed a real collection id but the wrong graph.
      await repo.renameCollection(collection.id, 'Hijacked', graphBId);
      await repo.shareCollection(collection.id, graphBId);
      await repo.deleteCollection(collection.id, graphBId);

      const list = await client.getGraphCollections({ federatedGraphName: graphA, namespace: 'default' });
      expect(list.collections).toHaveLength(1);
      expect(list.collections[0].name).toBe('Cart');
      // Still private: the share did not land either.
      expect(list.collections[0].isTeamScoped).toBe(false);
    });

    // Same reasoning as the collection writes above: the handler resolves the
    // operation and its collection together, so the collection condition on
    // these writes cannot be reached through the RPC surface.
    test('An operation write refuses a row from another collection', async () => {
      const { client, server, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const owning = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Owning',
      });
      const other = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Other',
      });

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: owning.id,
        name: 'Totals',
        query: QUERY,
      });

      const repo = new GraphCollectionsRepository(server.log, server.db, users.adminAliceCompanyA.organizationId);

      // A real operation id, paired with a collection that does not own it.
      await repo.renameOperation(created.id, 'Hijacked', other.id, users.adminAliceCompanyA.userId);
      await repo.deleteOperation(created.id, other.id);
      const updated = await repo.updateOperation({
        id: created.id,
        collectionId: other.id,
        query: 'query Other { cart { id } }',
        expectedContentHash: created.contentHash,
        userId: users.adminAliceCompanyA.userId,
      });
      // Nothing matched, which this method reports the same way as a conflict.
      expect(updated).toBeUndefined();

      const fetched = await client.getGraphCollectionOperation({
        collectionId: owning.id,
        id: created.id,
        federatedGraphId,
      });
      expect(fetched.response?.code).toBe(EnumStatusCode.OK);
      expect(fetched.operation?.name).toBe('Totals');
      expect(fetched.operation?.query).toBe(QUERY);
      expect(fetched.operation?.contentHash).toBe(created.contentHash);
    });

    test('Naming the wrong collection for a real operation is a miss', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const owning = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Owning',
      });
      const decoy = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Decoy',
      });

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: owning.id,
        name: 'Totals',
        query: QUERY,
      });

      // Both collections are the caller's own, in the right graph. Only the
      // operation-to-collection pairing is wrong, and that alone must fail.
      const fetched = await client.getGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId: decoy.id,
      });
      expect(fetched.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const renamed = await client.renameGraphCollectionOperation({
        id: created.id,
        name: 'Hijacked',
        federatedGraphId,
        collectionId: decoy.id,
      });
      expect(renamed.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const updated = await client.updateGraphCollectionOperation({
        id: created.id,
        query: 'query Other { cart { id } }',
        expectedContentHash: created.contentHash,
        federatedGraphId,
        collectionId: decoy.id,
      });
      expect(updated.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const deleted = await client.deleteGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId: decoy.id,
      });
      expect(deleted.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      // Untouched under the collection that really owns it.
      const still = await client.getGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId: owning.id,
      });
      expect(still.response?.code).toBe(EnumStatusCode.OK);
      expect(still.operation?.name).toBe('Totals');
      expect(still.operation?.contentHash).toBe(created.contentHash);
    });

    test('Deleting a collection cascades to its operations', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Doomed',
      });

      const first = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'One',
        query: QUERY,
      });
      const second = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Two',
        query: QUERY,
      });

      const deleted = await client.deleteGraphCollection({ federatedGraphId, id: collection.id });
      expect(deleted.response?.code).toBe(EnumStatusCode.OK);

      for (const id of [first.id, second.id]) {
        const res = await client.getGraphCollectionOperation({ collectionId: collection.id, federatedGraphId, id });
        expect(res.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      }
    });

    test('A graph-viewer scoped to one graph cannot read another graph’s collections', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphA = genID('fedGraph');
      const graphB = genID('fedGraph');
      await createFederatedGraph(client, graphA, 'default', [], DEFAULT_ROUTER_URL);
      await createFederatedGraph(client, graphB, 'default', [], DEFAULT_ROUTER_URL);

      const graphAResponse = await client.getFederatedGraphByName({ name: graphA, namespace: 'default' });
      expect(graphAResponse.graph?.targetId).toBeDefined();

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({ role: 'graph-viewer', resources: [graphAResponse.graph!.targetId] }),
        ),
      });

      const allowed = await client.getGraphCollections({ federatedGraphName: graphA, namespace: 'default' });
      expect(allowed.response?.code).toBe(EnumStatusCode.OK);

      const denied = await client.getGraphCollections({ federatedGraphName: graphB, namespace: 'default' });
      expect(denied.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      expect(denied.collections).toEqual([]);
    });
  });

  describe('Operations', () => {
    test('Round-trips an operation', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Cart totals',
        query: QUERY,
        variables: '{"id":"1"}',
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);
      expect(created.contentHash).toBeTruthy();

      const fetched = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
      });
      expect(fetched.response?.code).toBe(EnumStatusCode.OK);
      expect(fetched.operation?.query).toBe(QUERY);
      expect(fetched.operation?.variables).toBe('{"id":"1"}');
      expect(fetched.operation?.name).toBe('Cart totals');
      expect(fetched.operation?.contentHash).toBe(created.contentHash);
    });

    test('Rejects a document that is not valid GraphQL', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Half-written',
        query: 'query {{{',
      });

      expect(created.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(created.response?.details).toBe('Operation is not valid GraphQL. Syntax Error: Expected Name, found "{".');
      expect(created.id).toBe('');
    });

    test('Accepts a document that is valid GraphQL but names a field the graph does not have', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const query = 'query GetCart { cart { nonExistentField } }';
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Stale field',
        query,
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      const fetched = await client.getGraphCollectionOperation({
        collectionId,
        federatedGraphId,
        id: created.id,
      });
      expect(fetched.operation?.query).toBe(query);
    });

    test('Rejects variables that are not valid JSON', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Broken variables',
        query: QUERY,
        variables: '{"id":',
      });

      expect(created.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(created.response?.details).toBe('Operation variables must be valid JSON');
    });

    test('Rejects a document that is not valid GraphQL on update', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Breaks later',
        query: QUERY,
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      // Update is a separate handler; validating only on create would let a
      // good document be replaced by rubbish.
      const updated = await client.updateGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId,
        query: 'not a graphql document at all',
        expectedContentHash: created.contentHash,
      });
      expect(updated.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(updated.response?.details).toBe('Operation is not valid GraphQL. Syntax Error: Unexpected Name "not".');

      const fetched = await client.getGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId,
      });
      expect(fetched.operation?.query).toBe(QUERY);
    });

    test('The list returns operation metadata without bodies', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Totals',
        query: QUERY,
      });

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      const [operation] = list.collections[0].operations;
      expect(operation.name).toBe('Totals');
      // Metadata carries no body, that is the point of the separate fetch.
      expect(operation).not.toHaveProperty('query');
    });

    test('Renames an operation without touching the document', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Old label',
        query: QUERY,
      });

      const renamed = await client.renameGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        name: 'New label',
      });
      expect(renamed.response?.code).toBe(EnumStatusCode.OK);

      const fetched = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
      });
      expect(fetched.operation?.name).toBe('New label');
      expect(fetched.operation?.query).toBe(QUERY);
      // A rename must not move the content hash, or it would invalidate
      // everyone's in-flight save preconditions.
      expect(fetched.operation?.contentHash).toBe(created.contentHash);
    });

    test('Deletes an operation', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Doomed',
        query: QUERY,
      });

      expect(
        (await client.deleteGraphCollectionOperation({ collectionId: collection.id, federatedGraphId, id: created.id }))
          .response?.code,
      ).toBe(EnumStatusCode.OK);
      expect(
        (await client.getGraphCollectionOperation({ collectionId: collection.id, federatedGraphId, id: created.id }))
          .response?.code,
      ).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });
  });

  describe('Concurrent edits', () => {
    test('Rejects a save whose precondition is stale, leaving the stored row untouched', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Totals',
        query: QUERY,
      });

      // Both clients loaded this hash.
      const staleHash = created.contentHash;

      const first = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: 'query GetCart { cart { id total } }',
        expectedContentHash: staleHash,
      });
      expect(first.response?.code).toBe(EnumStatusCode.OK);
      expect(first.contentHash).not.toBe(staleHash);

      const second = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: 'query GetCart { cart { somethingElse } }',
        expectedContentHash: staleHash,
      });
      expect(second.response?.code).toBe(EnumStatusCode.ERR_CONFLICT);

      // The rejected write must have changed nothing.
      const fetched = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
      });
      expect(fetched.operation?.query).toBe('query GetCart { cart { id total } }');
      expect(fetched.operation?.contentHash).toBe(first.contentHash);
    });

    test('Saving again with the hash returned by the previous save succeeds', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Totals',
        query: QUERY,
      });

      const first = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: 'query GetCart { cart { id total } }',
        expectedContentHash: created.contentHash,
      });
      expect(first.response?.code).toBe(EnumStatusCode.OK);

      const second = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: 'query GetCart { cart { id total currency } }',
        expectedContentHash: first.contentHash,
      });
      expect(second.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Saving identical content does not conflict', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Totals',
        query: QUERY,
      });

      // A no-op save keeps the hash, so clicking Save twice is harmless.
      const first = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: QUERY,
        expectedContentHash: created.contentHash,
      });
      expect(first.response?.code).toBe(EnumStatusCode.OK);
      expect(first.contentHash).toBe(created.contentHash);

      const second = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: QUERY,
        expectedContentHash: created.contentHash,
      });
      expect(second.response?.code).toBe(EnumStatusCode.OK);
    });

    test('Variables are part of the hash', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Totals',
        query: QUERY,
        variables: '{"id":"1"}',
      });

      const changed = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
        query: QUERY,
        variables: '{"id":"2"}',
        expectedContentHash: created.contentHash,
      });
      expect(changed.response?.code).toBe(EnumStatusCode.OK);
      expect(changed.contentHash).not.toBe(created.contentHash);
    });
  });

  describe('Private scope', () => {
    test('A private collection is invisible to another member of the same organization', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Alice private',
      });

      authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);

      const bobList = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(bobList.response?.code).toBe(EnumStatusCode.OK);
      expect(bobList.collections).toEqual([]);

      // Not found rather than unauthorized: the response must not confirm that
      // a collection with this id exists.
      const bobRename = await client.renameGraphCollection({ federatedGraphId, id: created.id, name: 'Hijacked' });
      expect(bobRename.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

      const bobDelete = await client.deleteGraphCollection({ federatedGraphId, id: created.id });
      expect(bobDelete.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test("Another member cannot read an operation in someone's private collection", async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Alice private',
      });
      const operation = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Secret',
        query: QUERY,
      });

      authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);

      const res = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: operation.id,
      });
      expect(res.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    });

    test('A graph-viewer can create and edit their own private collection', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const graphResponse = await client.getFederatedGraphByName({ name: graphName, namespace: 'default' });

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(
          createTestGroup({ role: 'graph-viewer', resources: [graphResponse.graph!.targetId] }),
        ),
      });

      // A private collection is the caller's own scratchpad, read access is
      // enough, or read-only members could never save anything.
      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Viewer private',
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      const renamed = await client.renameGraphCollection({ federatedGraphId, id: created.id, name: 'Still mine' });
      expect(renamed.response?.code).toBe(EnumStatusCode.OK);

      const operation = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: created.id,
        name: 'Mine',
        query: QUERY,
      });
      expect(operation.response?.code).toBe(EnumStatusCode.OK);
    });
  });

  describe('Team scope', () => {
    test('Sharing makes a collection visible to another member', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Onboarding examples',
      });
      await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: created.id,
        name: 'Example',
        query: QUERY,
      });

      const shared = await client.shareGraphCollection({ federatedGraphId, id: created.id });
      expect(shared.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);

      const bobList = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(bobList.collections).toHaveLength(1);
      expect(bobList.collections[0].isTeamScoped).toBe(true);
      expect(bobList.collections[0].operations).toHaveLength(1);
      // Attribution survives promotion to team scope.
      expect(bobList.collections[0].createdByEmail).toBe(users.adminAliceCompanyA.email);
    });

    test('Sharing is one-way and cannot be repeated', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Shared once',
      });

      expect((await client.shareGraphCollection({ federatedGraphId, id: created.id })).response?.code).toBe(
        EnumStatusCode.OK,
      );

      const again = await client.shareGraphCollection({ federatedGraphId, id: created.id });
      expect(again.response?.code).toBe(EnumStatusCode.ERR_ALREADY_EXISTS);

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections[0].isTeamScoped).toBe(true);
    });

    test.each(['graph-viewer', 'organization-viewer'])(
      'A %s is not offered team collections and cannot create one',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const graphName = genID('fedGraph');
        await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);

        const asAdmin = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
        expect(asAdmin.canCreateTeamCollection).toBe(true);

        const graphResponse = await client.getFederatedGraphByName({ name: graphName, namespace: 'default' });

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [graphResponse.graph!.targetId] })),
        });

        const asViewer = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
        expect(asViewer.canCreateTeamCollection).toBe(false);

        // The flag has to agree with what the create call actually permits, or
        // the UI offers an option that fails on submit.
        const rejected = await client.createGraphCollection({
          federatedGraphName: graphName,
          namespace: 'default',
          name: 'Team',
          teamScoped: true,
        });
        expect(rejected.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );

    test('Can create a collection team-scoped from the start', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Team from birth',
        teamScoped: true,
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections[0].isTeamScoped).toBe(true);
    });

    test('Another member with write access can add operations to a shared collection', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Team',
        teamScoped: true,
      });

      authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);
      const added = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: created.id,
        name: 'From Bob',
        query: QUERY,
      });
      expect(added.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext(users.adminAliceCompanyA);
      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections[0].operations).toEqual([expect.objectContaining({ name: 'From Bob' })]);
    });

    test('Renaming an operation attributes the update to whoever renamed it', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Team',
        teamScoped: true,
      });

      const operation = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: created.id,
        name: 'From Alice',
        query: QUERY,
      });
      expect(operation.response?.code).toBe(EnumStatusCode.OK);

      // A rename bumps `updated_at`, so it has to move `updated_by` with it or
      // the row credits the change to whoever last edited the document.
      authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);
      const renamed = await client.renameGraphCollectionOperation({
        id: operation.id,
        federatedGraphId,
        collectionId: created.id,
        name: 'Renamed by Bob',
      });
      expect(renamed.response?.code).toBe(EnumStatusCode.OK);

      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.collections[0].operations).toEqual([
        expect.objectContaining({
          name: 'Renamed by Bob',
          updatedByEmail: users.adminBobCompanyA!.email,
        }),
      ]);
    });

    test('Two members editing the same shared operation cannot silently overwrite each other', async () => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, enableMultiUsers: true });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Team',
        teamScoped: true,
      });
      const operation = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: 'Shared',
        query: QUERY,
      });

      // Both have the operation open, so both hold this hash.
      const sharedHash = operation.contentHash;

      authenticator.changeUserWithSuppliedContext(users.adminBobCompanyA!);
      const bobSave = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: operation.id,
        query: 'query GetCart { cart { bob } }',
        expectedContentHash: sharedHash,
      });
      expect(bobSave.response?.code).toBe(EnumStatusCode.OK);

      authenticator.changeUserWithSuppliedContext(users.adminAliceCompanyA);
      const aliceSave = await client.updateGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: operation.id,
        query: 'query GetCart { cart { alice } }',
        expectedContentHash: sharedHash,
      });
      expect(aliceSave.response?.code).toBe(EnumStatusCode.ERR_CONFLICT);

      const fetched = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: operation.id,
      });
      expect(fetched.operation?.query).toBe('query GetCart { cart { bob } }');
      expect(fetched.operation?.updatedByEmail).toBe(users.adminBobCompanyA!.email);
    });

    test.each(['graph-viewer', 'organization-viewer'])(
      'A %s cannot mutate a team collection but sees it as read-only',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const graphName = genID('fedGraph');
        await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
        const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' }))
          .graph!.id;

        const created = await client.createGraphCollection({
          federatedGraphName: graphName,
          namespace: 'default',
          name: 'Team',
          teamScoped: true,
        });

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
        expect(list.response?.code).toBe(EnumStatusCode.OK);
        expect(list.collections).toHaveLength(1);
        expect(list.collections[0].canEdit).toBe(false);

        const renamed = await client.renameGraphCollection({ federatedGraphId, id: created.id, name: 'Nope' });
        expect(renamed.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

        const added = await client.createGraphCollectionOperation({
          federatedGraphId,
          collectionId: created.id,
          name: 'Nope',
          query: QUERY,
        });
        expect(added.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

        const deleted = await client.deleteGraphCollection({ federatedGraphId, id: created.id });
        expect(deleted.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );

    test.each(['graph-viewer', 'organization-viewer'])(
      'A %s cannot rename, overwrite or delete an operation in a team collection',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const graphName = genID('fedGraph');
        await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
        const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' }))
          .graph!.id;

        const collection = await client.createGraphCollection({
          federatedGraphName: graphName,
          namespace: 'default',
          name: 'Team',
          teamScoped: true,
        });

        const created = await client.createGraphCollectionOperation({
          federatedGraphId,
          collectionId: collection.id,
          name: 'Cart',
          query: QUERY,
        });
        expect(created.response?.code).toBe(EnumStatusCode.OK);

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role })),
        });

        // Reading is what the role grants, so the body still comes back.
        const fetched = await client.getGraphCollectionOperation({
          federatedGraphId,
          collectionId: collection.id,
          id: created.id,
        });
        expect(fetched.response?.code).toBe(EnumStatusCode.OK);
        expect(fetched.operation?.query).toBe(QUERY);

        const renamed = await client.renameGraphCollectionOperation({
          federatedGraphId,
          collectionId: collection.id,
          id: created.id,
          name: 'Nope',
        });
        expect(renamed.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

        const updated = await client.updateGraphCollectionOperation({
          federatedGraphId,
          collectionId: collection.id,
          id: created.id,
          query: 'query GetCart { cart { bob } }',
          expectedContentHash: created.contentHash,
        });
        expect(updated.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

        const deleted = await client.deleteGraphCollectionOperation({
          federatedGraphId,
          collectionId: collection.id,
          id: created.id,
        });
        expect(deleted.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

        // A refused mutation must leave the stored row exactly as it was.
        const after = await client.getGraphCollectionOperation({
          federatedGraphId,
          collectionId: collection.id,
          id: created.id,
        });
        expect(after.response?.code).toBe(EnumStatusCode.OK);
        expect(after.operation?.name).toBe('Cart');
        expect(after.operation?.query).toBe(QUERY);
      },
    );

    test.each(['graph-viewer', 'organization-viewer'])('A %s cannot share their own collection', async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const graphResponse = await client.getFederatedGraphByName({ name: graphName, namespace: 'default' });

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [graphResponse.graph!.targetId] })),
      });

      const created = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Viewer private',
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      // Sharing creates a graph-scoped resource, so it needs graph write access
      // even though creating the private original did not.
      const shared = await client.shareGraphCollection({ federatedGraphId, id: created.id });
      expect(shared.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);

      // Scope cannot be walked back, so a refused share has to leave the
      // collection private rather than half-promoted.
      const list = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(list.response?.code).toBe(EnumStatusCode.OK);
      expect(list.collections).toHaveLength(1);
      expect(list.collections[0].name).toBe('Viewer private');
      expect(list.collections[0].isTeamScoped).toBe(false);
    });

    test.each(['graph-viewer', 'organization-viewer'])(
      'A %s cannot create a team-scoped collection directly',
      async (role) => {
        const { client, server, authenticator, users } = await SetupTest({ dbname });
        onTestFinished(() => server.close());

        const graphName = genID('fedGraph');
        await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
        const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' }))
          .graph!.id;

        const graphResponse = await client.getFederatedGraphByName({ name: graphName, namespace: 'default' });

        authenticator.changeUserWithSuppliedContext({
          ...users.adminAliceCompanyA,
          rbac: createTestRBACEvaluator(createTestGroup({ role, resources: [graphResponse.graph!.targetId] })),
        });

        const created = await client.createGraphCollection({
          federatedGraphName: graphName,
          namespace: 'default',
          name: 'Team',
          teamScoped: true,
        });
        expect(created.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
      },
    );
  });

  describe('Operation size limits', () => {
    // `query` and `variables` are unbounded `text` columns and nothing between
    // the client and the database caps them, so the only thing standing between
    // a user and an arbitrarily large row is this check. Derived from the
    // constant rather than hardcoded, so the limit can move without the tests
    // quietly testing the wrong boundary.
    const atLimit = documentOfLength(MAX_OPERATION_LENGTH);
    const overLimit = documentOfLength(MAX_OPERATION_LENGTH + 1);
    // Valid JSON, so this can only be rejected on length.
    const oversizedVariables = `{"q":"${'v'.repeat(MAX_OPERATION_LENGTH)}"}`;

    test('Rejects a document over the limit on create', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Huge',
        query: overLimit,
      });

      expect(created.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(created.response?.details).toBe(`Operation cannot be longer than ${MAX_OPERATION_LENGTH} characters`);
      expect(created.id).toBe('');
    });

    test('Rejects variables over the limit on create', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Huge variables',
        query: QUERY,
        variables: oversizedVariables,
      });

      expect(created.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(created.response?.details).toBe(
        `Operation variables cannot be longer than ${MAX_OPERATION_LENGTH} characters`,
      );
    });

    test('Accepts a document exactly at the limit', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      // The boundary is inclusive, so a document of exactly the limit must
      // still save. Without this the two rejection tests above would pass just
      // as happily against an off-by-one that rejects legitimate documents.
      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'At the limit',
        query: atLimit,
      });

      expect(created.response?.code).toBe(EnumStatusCode.OK);

      const fetched = await client.getGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId,
      });
      expect(fetched.operation?.query).toHaveLength(MAX_OPERATION_LENGTH);
    });

    test('Rejects a document over the limit on update', async () => {
      const { client, server, federatedGraphId, collectionId } = await setupGraphWithCollection();
      onTestFinished(() => server.close());

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId,
        name: 'Grows later',
        query: QUERY,
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      // Update is a separate handler, so a limit on create alone would leave
      // this path open.
      const updated = await client.updateGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId,
        query: overLimit,
        expectedContentHash: created.contentHash,
      });

      expect(updated.response?.code).toBe(EnumStatusCode.ERR_BAD_REQUEST);
      expect(updated.response?.details).toBe(`Operation cannot be longer than ${MAX_OPERATION_LENGTH} characters`);

      // The stored document is untouched.
      const fetched = await client.getGraphCollectionOperation({
        id: created.id,
        federatedGraphId,
        collectionId,
      });
      expect(fetched.operation?.query).toBe(QUERY);
    });
  });

  describe('Injection safety', () => {
    // Every query in GraphCollectionsRepository is built with Drizzle's query
    // builder, so user input is bound as a parameter and never concatenated
    // into SQL. These tests assert the observable consequence of that: hostile
    // input is stored and returned verbatim, and the tables are still there
    // afterwards. The name validation regex is a display-integrity rule, not a
    // security control, and must never be relied on as one.
    const INJECTION = [
      "'; DROP TABLE graph_collections; --",
      "' OR '1'='1",
      'Robert"); DROP TABLE graph_collection_operations;--',
      '100%_like\\_wildcards',
      // Text that mimics a bind placeholder, to prove nothing re-reads it.
      // eslint-disable-next-line no-template-curly-in-string
      '$1 $2 ${name}',
    ];

    test('Stores and returns injection-shaped names verbatim', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      for (const name of INJECTION) {
        const created = await client.createGraphCollection({
          federatedGraphName: graphName,
          namespace: 'default',
          name,
        });
        expect(created.response?.code).toBe(EnumStatusCode.OK);
      }

      // The list still works, which it could not if any statement above had
      // closed its string and run a second one. This also exercises the single
      // raw SQL fragment in the repository, the ORDER BY lower(name).
      const listed = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(listed.response?.code).toBe(EnumStatusCode.OK);
      expect(listed.collections.map((c) => c.name).sort()).toEqual([
        // eslint-disable-next-line no-template-curly-in-string
        '$1 $2 ${name}',
        "' OR '1'='1",
        "'; DROP TABLE graph_collections; --",
        '100%_like\\_wildcards',
        'Robert"); DROP TABLE graph_collection_operations;--',
      ]);
    });

    test('Stores and returns injection-shaped documents and variables verbatim', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      const collection = await client.createGraphCollection({
        federatedGraphName: graphName,
        namespace: 'default',
        name: 'Cart',
      });

      // A saved document is opaque text that is never executed as SQL, so the
      // most hostile possible body must survive a round trip unchanged.
      const query = `query GetCart { cart(filter: "'; DROP TABLE graph_collections; --") { id } }`;
      const variables = String.raw`{"q":"' OR 1=1 --","path":"C:\\temp\\x"}`;

      const created = await client.createGraphCollectionOperation({
        federatedGraphId,
        collectionId: collection.id,
        name: "'; DELETE FROM graph_collection_operations; --",
        query,
        variables,
      });
      expect(created.response?.code).toBe(EnumStatusCode.OK);

      const fetched = await client.getGraphCollectionOperation({
        collectionId: collection.id,
        federatedGraphId,
        id: created.id,
      });
      expect(fetched.response?.code).toBe(EnumStatusCode.OK);
      expect(fetched.operation?.query).toBe(query);
      expect(fetched.operation?.variables).toBe(variables);
      expect(fetched.operation?.name).toBe("'; DELETE FROM graph_collection_operations; --");

      // The collection, and the row we just read, both still exist.
      const listed = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(listed.collections).toHaveLength(1);
      expect(listed.collections[0].operations).toHaveLength(1);
    });

    test('An injection-shaped id is rejected cleanly rather than erroring', async () => {
      const { client, server } = await SetupTest({ dbname });
      onTestFinished(() => server.close());

      const graphName = genID('fedGraph');
      await createFederatedGraph(client, graphName, 'default', [], DEFAULT_ROUTER_URL);
      const federatedGraphId = (await client.getFederatedGraphByName({ name: graphName, namespace: 'default' })).graph!
        .id;

      // Ids reach a uuid column, so a malformed one must not surface as a
      // database error leaking the statement back to the caller.
      for (const id of INJECTION) {
        const fetched = await client.getGraphCollectionOperation({ collectionId: id, federatedGraphId, id });
        expect(fetched.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

        const renamed = await client.renameGraphCollection({ federatedGraphId, id, name: 'x' });
        expect(renamed.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);

        const deleted = await client.deleteGraphCollection({ federatedGraphId, id });
        expect(deleted.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
      }

      const listed = await client.getGraphCollections({ federatedGraphName: graphName, namespace: 'default' });
      expect(listed.response?.code).toBe(EnumStatusCode.OK);
    });
  });
});
