import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { and, eq } from 'drizzle-orm';
import { afterAllSetup, beforeAllSetup, genID } from '../src/core/test-util.js';
import * as schema from '../src/db/schema.js';
import { flushMapperIntoResponse, RouterConfigMapperUpdater } from '../src/core/services/RouterConfigMapperUpdater.js';
import { ClickHouseClient } from '../src/core/clickhouse/index.js';
import {
  createAndPublishSubgraph,
  createFederatedGraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
  readBlob,
} from './test-util.js';

let dbname = '';

vi.mock('../src/core/clickhouse/index.js', () => {
  const ClickHouseClient = vi.fn();
  ClickHouseClient.prototype.queryPromise = vi.fn();

  return { ClickHouseClient };
});

type TestSetup = Awaited<ReturnType<typeof SetupTest>>;

async function createGraph({ client, users }: TestSetup) {
  const labels = [{ key: 'team', value: genID('team') }];
  await createAndPublishSubgraph(
    client,
    genID('subgraph'),
    DEFAULT_NAMESPACE,
    'type Query { hello: String! }',
    labels,
    DEFAULT_SUBGRAPH_URL_ONE,
  );

  const name = genID('fedGraph');
  await createFederatedGraph(client, name, DEFAULT_NAMESPACE, [`team=${labels[0].value}`], DEFAULT_ROUTER_URL);

  const response = await client.getFederatedGraphByName({ name, namespace: DEFAULT_NAMESPACE });
  expect(response.response?.code).toBe(EnumStatusCode.OK);

  const organizationId = users.adminAliceCompanyA.organizationId;
  return {
    id: response.graph!.id,
    name,
    namespace: DEFAULT_NAMESPACE,
    mapperKey: `${organizationId}/${response.graph!.id}/manifest/mapper.json`,
  };
}

async function createFeatureFlagRow({ server, users }: TestSetup, name: string) {
  const organizationId = users.adminAliceCompanyA.organizationId;
  const [namespace] = await server.db
    .select({ id: schema.namespaces.id })
    .from(schema.namespaces)
    .where(and(eq(schema.namespaces.organizationId, organizationId), eq(schema.namespaces.name, DEFAULT_NAMESPACE)))
    .execute();

  const [featureFlag] = await server.db
    .insert(schema.featureFlags)
    .values({ name, organizationId, namespaceId: namespace.id })
    .returning({ id: schema.featureFlags.id })
    .execute();

  return featureFlag.id;
}

async function setRouterConfigHash(
  { server }: TestSetup,
  federatedGraphId: string,
  hash: string,
  featureFlagId: string | null = null,
) {
  await server.db
    .insert(schema.routerConfigHash)
    .values({ federatedGraphId, featureFlagId, hash })
    .onConflictDoUpdate({
      target: [schema.routerConfigHash.federatedGraphId, schema.routerConfigHash.featureFlagId],
      set: { hash, updatedAt: new Date() },
    })
    .execute();
}

async function clearRouterConfigHashes({ server }: TestSetup, federatedGraphId: string) {
  await server.db
    .delete(schema.routerConfigHash)
    .where(eq(schema.routerConfigHash.federatedGraphId, federatedGraphId))
    .execute();
}

type LockAdapter = TestSetup['server']['lockAdapter'];

function createUpdater({ server, users, blobStorage }: TestSetup, lockAdapter: LockAdapter = server.lockAdapter) {
  return new RouterConfigMapperUpdater(
    server.db,
    lockAdapter,
    users.adminAliceCompanyA.organizationId,
    server.log,
    blobStorage,
  );
}

// Mirrors the lock key and acquisition timeout used by RouterConfigMapperUpdater
const LOCK_ACQUISITION_TIMEOUT = 5 * 60_000;
const mapperLockKey = (federatedGraphId: string) => `controlplane:router-config-mapper:${federatedGraphId}`;

function mockLockAdapter({ failedAttempts = 0, onAttempt }: { failedAttempts?: number; onAttempt?: () => void } = {}) {
  const using = vi.fn(
    (_resources: string[], _duration: number, _settings: unknown, routine: () => Promise<unknown>) => {
      onAttempt?.();
      if (using.mock.calls.length <= failedAttempts) {
        return Promise.reject(new Error('failed to acquire lock'));
      }

      return Promise.resolve(routine());
    },
  );

  return { lockAdapter: { using } as unknown as LockAdapter, using };
}

function mapperUploads(putObjectSpy: { mock: { calls: any[][] } }) {
  return putObjectSpy.mock.calls.map(([data]) => data).filter((data) => data.key.endsWith('/mapper.json'));
}

const stubUpdater = (deploymentErrors: { federatedGraphName: string; namespace: string; message: string }[]) =>
  ({ flush: vi.fn().mockResolvedValue(deploymentErrors) }) as unknown as RouterConfigMapperUpdater;

describe('RouterConfigMapperUpdater', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(() => afterAllSetup(dbname));

  test('that flush uploads a mapper built from the router config hashes in the database', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    const featureFlagName = genID('flag');
    const featureFlagId = await createFeatureFlagRow(setup, featureFlagName);
    await setRouterConfigHash(setup, graph.id, 'base-hash');
    await setRouterConfigHash(setup, graph.id, 'flag-hash', featureFlagId);

    const putObjectSpy = vi.spyOn(setup.blobStorage, 'putObject');
    const updater = createUpdater(setup);
    updater.schedule(graph);

    const deploymentErrors = await updater.flush();
    expect(deploymentErrors).toHaveLength(0);

    const mapperContent = await readBlob(setup.blobStorage, graph.mapperKey);
    expect(JSON.parse(mapperContent)).toStrictEqual({ '': 'base-hash', [featureFlagName]: 'flag-hash' });

    const uploads = mapperUploads(putObjectSpy);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('application/json; charset=utf-8');

    const { version, 'signature-sha256': signature } = uploads[0].metadata;
    expect(version).toBeTruthy();
    expect(signature).toBe(createHash('sha256').update(version).update(mapperContent).digest('hex'));
  });

  test('that flush uploads an empty mapper when the graph has no router config hashes', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await clearRouterConfigHashes(setup, graph.id);

    const updater = createUpdater(setup);
    updater.schedule(graph);

    expect(await updater.flush()).toHaveLength(0);
    expect(JSON.parse(await readBlob(setup.blobStorage, graph.mapperKey))).toStrictEqual({});
  });

  test('that scheduling the same graph multiple times results in a single upload', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'base-hash');

    const putObjectSpy = vi.spyOn(setup.blobStorage, 'putObject');
    const updater = createUpdater(setup);
    updater.schedule(graph);
    updater.schedule(graph);
    updater.schedule(graph);

    expect(await updater.flush()).toHaveLength(0);
    expect(mapperUploads(putObjectSpy)).toHaveLength(1);
  });

  test('that flush clears the pending work', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'base-hash');

    const putObjectSpy = vi.spyOn(setup.blobStorage, 'putObject');
    const deleteObjectSpy = vi.spyOn(setup.blobStorage, 'deleteObject');
    const updater = createUpdater(setup);
    updater.schedule(graph);
    updater.delete({ ...graph, key: 'some/key.json' });

    expect(await updater.flush()).toHaveLength(0);
    expect(mapperUploads(putObjectSpy)).toHaveLength(1);
    expect(deleteObjectSpy).toHaveBeenCalledTimes(1);

    expect(await updater.flush()).toHaveLength(0);
    expect(mapperUploads(putObjectSpy)).toHaveLength(1);
    expect(deleteObjectSpy).toHaveBeenCalledTimes(1);
  });

  test('that a failed upload is reported as a deployment error without blocking other graphs', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const failingGraph = await createGraph(setup);
    const healthyGraph = await createGraph(setup);
    await setRouterConfigHash(setup, failingGraph.id, 'failing-hash');
    await setRouterConfigHash(setup, healthyGraph.id, 'healthy-hash');

    // The mapper was already uploaded when the graph was composed
    const failingGraphMapperBefore = await readBlob(setup.blobStorage, failingGraph.mapperKey);

    const originalPutObject = setup.blobStorage.putObject.bind(setup.blobStorage);
    vi.spyOn(setup.blobStorage, 'putObject').mockImplementation((data) => {
      if (data.key === failingGraph.mapperKey) {
        return Promise.reject(new Error('blob storage unavailable'));
      }
      return originalPutObject(data);
    });

    const updater = createUpdater(setup);
    updater.schedule(failingGraph);
    updater.schedule(healthyGraph);

    const deploymentErrors = await updater.flush();
    expect(deploymentErrors).toStrictEqual([
      { federatedGraphName: failingGraph.name, namespace: failingGraph.namespace, message: 'blob storage unavailable' },
    ]);

    expect(await readBlob(setup.blobStorage, failingGraph.mapperKey)).toBe(failingGraphMapperBefore);
    expect(JSON.parse(await readBlob(setup.blobStorage, healthyGraph.mapperKey))).toStrictEqual({
      '': 'healthy-hash',
    });
  });

  test('that delete removes the scheduled key from blob storage', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setup.blobStorage.putObject({
      key: graph.mapperKey,
      body: Buffer.from('{}'),
      contentType: 'application/json; charset=utf-8',
    });

    const updater = createUpdater(setup);
    updater.delete({ ...graph, key: graph.mapperKey });

    expect(await updater.flush()).toHaveLength(0);
    expect(setup.blobStorage.keys()).not.toContain(graph.mapperKey);
  });

  test('that a failed deletion is reported as a deployment error', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    vi.spyOn(setup.blobStorage, 'deleteObject').mockRejectedValue(new Error('access denied'));

    const updater = createUpdater(setup);
    updater.delete({ ...graph, key: graph.mapperKey });

    expect(await updater.flush()).toStrictEqual([
      { federatedGraphName: graph.name, namespace: graph.namespace, message: 'access denied' },
    ]);
  });

  test('that concurrent rebuilds of the same graph are serialized so the latest hashes win', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'stale-hash');

    // Hold the first mapper upload until released, so the first rebuild keeps its lock while the second one starts
    let releaseFirstUpload!: () => void;
    const firstUploadReleased = new Promise<void>((resolve) => (releaseFirstUpload = resolve));

    let signalFirstUploadStarted!: () => void;
    const firstUploadStarted = new Promise<void>((resolve) => (signalFirstUploadStarted = resolve));

    let mapperUploadCount = 0;
    const originalPutObject = setup.blobStorage.putObject.bind(setup.blobStorage);
    const putObjectSpy = vi.spyOn(setup.blobStorage, 'putObject').mockImplementation(async (data) => {
      if (data.key === graph.mapperKey && ++mapperUploadCount === 1) {
        signalFirstUploadStarted();
        await firstUploadReleased;
      }

      return originalPutObject(data);
    });

    const firstUpdater = createUpdater(setup);
    firstUpdater.schedule(graph);
    const firstFlush = firstUpdater.flush();
    await firstUploadStarted;

    // A newer router config is persisted while the first rebuild is still uploading the stale mapper
    await setRouterConfigHash(setup, graph.id, 'latest-hash');

    const secondUpdater = createUpdater(setup);
    secondUpdater.schedule(graph);
    const secondFlush = secondUpdater.flush();

    // The second rebuild must wait for the first one to release the lock
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mapperUploads(putObjectSpy)).toHaveLength(1);

    releaseFirstUpload();
    expect(await firstFlush).toHaveLength(0);
    expect(await secondFlush).toHaveLength(0);

    expect(mapperUploads(putObjectSpy)).toHaveLength(2);
    expect(JSON.parse(await readBlob(setup.blobStorage, graph.mapperKey))).toStrictEqual({ '': 'latest-hash' });
  });

  test('that a rebuild retries when the lock cannot be acquired', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'base-hash');

    const { lockAdapter, using } = mockLockAdapter({ failedAttempts: 3 });
    const putObjectSpy = vi.spyOn(setup.blobStorage, 'putObject');

    const updater = createUpdater(setup, lockAdapter);
    updater.schedule(graph);

    expect(await updater.flush()).toHaveLength(0);

    // Three failed attempts followed by the one that acquired the lock, all without trying to upload the mapper
    expect(using).toHaveBeenCalledTimes(4);
    for (const call of using.mock.calls) {
      expect(call).toStrictEqual([
        [mapperLockKey(graph.id)],
        expect.any(Number),
        expect.objectContaining({ retryCount: 0 }),
        expect.any(Function),
      ]);
    }

    expect(mapperUploads(putObjectSpy)).toHaveLength(1);
    expect(JSON.parse(await readBlob(setup.blobStorage, graph.mapperKey))).toStrictEqual({ '': 'base-hash' });
  });

  test('that a rebuild gives up once the lock acquisition deadline has passed', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'base-hash');

    // Only fake the clock, so the backoff between attempts and the database keep using real timers
    vi.useFakeTimers({ toFake: ['Date'] });

    // Every attempt fails and moves the clock forward by a fifth of the deadline, so the fifth attempt is the last
    const { lockAdapter, using } = mockLockAdapter({
      failedAttempts: Number.POSITIVE_INFINITY,
      onAttempt: () => vi.setSystemTime(Date.now() + LOCK_ACQUISITION_TIMEOUT / 5 + 1),
    });
    const putObjectSpy = vi.spyOn(setup.blobStorage, 'putObject');

    const updater = createUpdater(setup, lockAdapter);
    updater.schedule(graph);

    expect(await updater.flush()).toStrictEqual([
      { federatedGraphName: graph.name, namespace: graph.namespace, message: 'failed to acquire lock' },
    ]);
    expect(using).toHaveBeenCalledTimes(5);
    expect(mapperUploads(putObjectSpy)).toHaveLength(0);
  });

  test('that a failed upload bails out instead of retrying under a new lock', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'base-hash');

    // The mapper was already uploaded when the graph was composed
    const mapperBefore = await readBlob(setup.blobStorage, graph.mapperKey);

    const { lockAdapter, using } = mockLockAdapter();
    const putObjectSpy = vi
      .spyOn(setup.blobStorage, 'putObject')
      .mockRejectedValue(new Error('blob storage unavailable'));

    const updater = createUpdater(setup, lockAdapter);
    updater.schedule(graph);

    // The original upload error is reported, not the internal marker error
    expect(await updater.flush()).toStrictEqual([
      { federatedGraphName: graph.name, namespace: graph.namespace, message: 'blob storage unavailable' },
    ]);

    // The upload is retried within the lock, but the lock acquisition is not retried
    expect(using).toHaveBeenCalledTimes(1);
    expect(mapperUploads(putObjectSpy)).toHaveLength(3);
    expect(await readBlob(setup.blobStorage, graph.mapperKey)).toBe(mapperBefore);
  });

  test('that a transient upload failure is retried within the same lock', async (testContext) => {
    const setup = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => setup.server.close());

    const graph = await createGraph(setup);
    await setRouterConfigHash(setup, graph.id, 'base-hash');

    const { lockAdapter, using } = mockLockAdapter();
    const putObjectSpy = vi
      .spyOn(setup.blobStorage, 'putObject')
      .mockRejectedValueOnce(new Error('blob storage unavailable'))
      .mockRejectedValueOnce(new Error('blob storage unavailable'));

    const updater = createUpdater(setup, lockAdapter);
    updater.schedule(graph);

    expect(await updater.flush()).toHaveLength(0);
    expect(using).toHaveBeenCalledTimes(1);
    expect(mapperUploads(putObjectSpy)).toHaveLength(3);

    const mapperContent = await readBlob(setup.blobStorage, graph.mapperKey);
    const mapper = JSON.parse(mapperContent);

    expect(mapper).toBeDefined();
    expect(mapper).toStrictEqual({ '': 'base-hash' });
  });
});

describe('flushMapperIntoResponse', () => {
  test('that the result is returned unchanged when there are no deployment errors', async () => {
    const result = { response: { code: EnumStatusCode.OK } };
    expect(await flushMapperIntoResponse(stubUpdater([]), result)).toBe(result);
  });

  test('that an OK response is turned into a deployment failure and the errors are appended', async () => {
    const existingError = { federatedGraphName: 'a', namespace: 'default', message: 'existing' };
    const mapperError = { federatedGraphName: 'b', namespace: 'default', message: 'mapper failed' };

    const result = await flushMapperIntoResponse(stubUpdater([mapperError]), {
      response: { code: EnumStatusCode.OK },
      deploymentErrors: [existingError],
    });

    expect(result.response?.code).toBe(EnumStatusCode.ERR_DEPLOYMENT_FAILED);
    expect(result.deploymentErrors).toStrictEqual([mapperError, existingError]);
  });

  test('that a non-OK response code is preserved', async () => {
    const mapperError = { federatedGraphName: 'b', namespace: 'default', message: 'mapper failed' };

    const result = await flushMapperIntoResponse(stubUpdater([mapperError]), {
      response: { code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED },
      deploymentErrors: [],
    });

    expect(result.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(result.deploymentErrors).toStrictEqual([mapperError]);
  });
});
