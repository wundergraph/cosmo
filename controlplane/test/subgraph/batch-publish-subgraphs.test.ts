import { joinLabel } from '@wundergraph/cosmo-shared';
import { Client } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { PlatformService } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { formatISO } from 'date-fns';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { QueueEvents } from 'bullmq';
import {
  afterAllSetup,
  beforeAllSetup,
  createTestGroup,
  createTestRBACEvaluator,
  genID,
  genUniqueLabel,
} from '../../src/core/test-util.js';
import { ClickHouseClient } from '../../src/core/clickhouse/index.js';
import {
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  DEFAULT_NAMESPACE,
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  DEFAULT_SUBGRAPH_URL_TWO,
  SetupTest,
  tomorrowDate,
  yearStartDate,
} from '../test-util.js';
import {
  BatchPublishJobStatus,
  GetBatchPublishJobStatusResponse,
} from '../../../connect/src/wg/cosmo/platform/v1/platform_pb.js';
import { createDeleteBatchPublishJobDetailsWorker } from '../../src/core/workers/DeleteBatchPublishJobDetailsWorker.js';

let dbname = '';

const getCompositionCount = async (
  client: Client<typeof PlatformService>,
  fedGraphName: string,
  namespace = DEFAULT_NAMESPACE,
  excludeFeatureFlagCompositions = false,
): Promise<number> => {
  const res = await client.getCompositions({
    fedGraphName,
    namespace,
    startDate: formatISO(yearStartDate),
    endDate: formatISO(tomorrowDate),
    excludeFeatureFlagCompositions,
  });
  expect(res.response?.code).toBe(EnumStatusCode.OK);
  return res.compositions.length;
};

describe('Batch publish subgraphs tests', () => {
  let chClient: ClickHouseClient;

  beforeEach(() => {
    chClient = new ClickHouseClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that multiple existing subgraphs across multiple federated graphs can be published in one request', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label1 = genUniqueLabel('team1');
    const label2 = genUniqueLabel('team2');
    const fedGraph1 = genID('fedGraph1');
    const fedGraph2 = genID('fedGraph2');
    const subgraphA = genID('subgraphA');
    const subgraphB = genID('subgraphB');

    await createFederatedGraph(client, fedGraph1, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);
    await createFederatedGraph(client, fedGraph2, DEFAULT_NAMESPACE, [joinLabel(label2)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String }`,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createAndPublishSubgraph(
      client,
      subgraphB,
      DEFAULT_NAMESPACE,
      `type Query { b: String }`,
      [label2],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphA, schema: `type Query { a: String a2: String }` },
        { name: subgraphB, schema: `type Query { b: String b2: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.counts?.compositionErrors).toBe(0);
    expect(resp.counts?.deploymentErrors).toBe(0);
    expect(resp.updatedSubgraphNames).toHaveLength(2);
    expect(resp.updatedSubgraphNames).toEqual(expect.arrayContaining([subgraphA, subgraphB]));

    // Both federated graphs should now contain the published fields.
    const sdl1 = await client.getFederatedGraphSDLByName({ name: fedGraph1, namespace: DEFAULT_NAMESPACE });
    expect(sdl1.sdl).toContain('a2');
    const sdl2 = await client.getFederatedGraphSDLByName({ name: fedGraph2, namespace: DEFAULT_NAMESPACE });
    expect(sdl2.sdl).toContain('b2');
  });

  test('that a federated graph shared by many published subgraphs is composed exactly once', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel('shared');
    const fedGraph = genID('fedGraph');
    const subgraphA = genID('subgraphA');
    const subgraphB = genID('subgraphB');
    const subgraphC = genID('subgraphC');

    await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String }`,
      [label],
      'http://localhost:4001',
    );
    await createAndPublishSubgraph(
      client,
      subgraphB,
      DEFAULT_NAMESPACE,
      `type Query { b: String }`,
      [label],
      'http://localhost:4002',
    );
    await createAndPublishSubgraph(
      client,
      subgraphC,
      DEFAULT_NAMESPACE,
      `type Query { c: String }`,
      [label],
      'http://localhost:4003',
    );

    // All three subgraphs belong to the same federated graph. Capture the baseline composition count.
    const baseline = await getCompositionCount(client, fedGraph);

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphA, schema: `type Query { a: String a2: String }` },
        { name: subgraphB, schema: `type Query { b: String b2: String }` },
        { name: subgraphC, schema: `type Query { c: String c2: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.updatedSubgraphNames).toHaveLength(3);

    // Even though three subgraphs were published, the shared federated graph must be composed only ONCE.
    const after = await getCompositionCount(client, fedGraph);
    expect(after).toBe(baseline + 1);
  });

  test('that an error is returned if any subgraph does not exist and nothing is published', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel('team');
    const fedGraph = genID('fedGraph');
    const existing = genID('existing');
    const missing = genID('missing');

    await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      existing,
      DEFAULT_NAMESPACE,
      `type Query { a: String }`,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    const baseline = await getCompositionCount(client, fedGraph);

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: existing, schema: `type Query { a: String a2: String }` },
        { name: missing, schema: `type Query { b: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
    expect(resp.response?.details).toContain(missing);

    // Nothing should have been published: no new composition and the existing schema is unchanged.
    expect(await getCompositionCount(client, fedGraph)).toBe(baseline);
    const sdl = await client.getFederatedGraphSDLByName({ name: fedGraph, namespace: DEFAULT_NAMESPACE });
    expect(sdl.sdl).not.toContain('a2');
  });

  test('that composition errors are aggregated and independent graphs are still composed', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label1 = genUniqueLabel('team1');
    const label2 = genUniqueLabel('team2');
    const fedGraph1 = genID('fedGraph1');
    const fedGraph2 = genID('fedGraph2');
    const subgraphA = genID('subgraphA');
    const subgraphB = genID('subgraphB');
    const subgraphC = genID('subgraphC');

    await createFederatedGraph(client, fedGraph1, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);
    await createFederatedGraph(client, fedGraph2, DEFAULT_NAMESPACE, [joinLabel(label2)], DEFAULT_ROUTER_URL);
    // fedGraph1 is composed of A and B; fedGraph2 of C.
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String }`,
      [label1],
      'http://localhost:4001',
    );
    await createAndPublishSubgraph(
      client,
      subgraphB,
      DEFAULT_NAMESPACE,
      `type Query { b: String }`,
      [label1],
      'http://localhost:4002',
    );
    await createAndPublishSubgraph(
      client,
      subgraphC,
      DEFAULT_NAMESPACE,
      `type Query { c: String }`,
      [label2],
      'http://localhost:4003',
    );

    const fed2Baseline = await getCompositionCount(client, fedGraph2);

    // Publishing B with a field that conflicts with A breaks fedGraph1's composition, but fedGraph2 is unaffected.
    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphB, schema: `type Query { b: String a: Int }` },
        { name: subgraphC, schema: `type Query { c: String c2: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(resp.counts?.compositionErrors).toBeGreaterThan(0);
    expect(resp.compositionErrors.some((e) => e.federatedGraphName === fedGraph1)).toBe(true);

    // The independent federated graph should still have been composed successfully.
    expect(await getCompositionCount(client, fedGraph2)).toBe(fed2Baseline + 1);
  });

  test('that contracts of an affected federated graph are recomposed', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel('team');
    const fedGraph = genID('fedGraph');
    const contractGraph = genID('contract');
    const subgraphA = genID('subgraphA');

    await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String secret: String @tag(name: "exclude") }`,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    const createContractRes = await client.createContract({
      name: contractGraph,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraph,
      excludeTags: ['exclude'],
      routingUrl: 'http://localhost:8081',
    });
    expect(createContractRes.response?.code).toBe(EnumStatusCode.OK);

    const contractBaseline = await getCompositionCount(client, contractGraph);

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphA, schema: `type Query { a: String more: String secret: String @tag(name: "exclude") }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);

    // The contract derived from the source graph must be recomposed exactly once as part of the batch.
    expect(await getCompositionCount(client, contractGraph)).toBe(contractBaseline + 1);
    const contractSdl = await client.getFederatedGraphSDLByName({ name: contractGraph, namespace: DEFAULT_NAMESPACE });
    expect(contractSdl.sdl).toContain('more');
    // The excluded-tag field is marked @inaccessible in the contract, confirming the contract was recomposed.
    expect(contractSdl.sdl).toContain('secret: String @tag(name: "exclude") @inaccessible');
  });

  test('that feature subgraphs can be batch published alongside regular subgraphs', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel('team');
    const fedGraph = genID('fedGraph');
    const baseSubgraph = genID('base');
    const featureSubgraph = genID('feature');
    const featureFlag = genID('ff');

    await createAndPublishSubgraph(
      client,
      baseSubgraph,
      DEFAULT_NAMESPACE,
      `type Query { hello: String }`,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraph,
      baseSubgraph,
      DEFAULT_NAMESPACE,
      `type Query { hello: String }`,
      [],
      DEFAULT_SUBGRAPH_URL_TWO,
    );
    await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createFeatureFlag(client, featureFlag, [label], [featureSubgraph], DEFAULT_NAMESPACE, true);

    // A regular subgraph and a feature subgraph are published in the same request; the control plane detects the
    // feature subgraph automatically from a single subgraphs list.
    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: baseSubgraph, schema: `type Query { hello: String again: String }` },
        { name: featureSubgraph, schema: `type Query { hello: String world: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.updatedSubgraphNames).toHaveLength(2);
    expect(resp.updatedSubgraphNames).toEqual(expect.arrayContaining([baseSubgraph, featureSubgraph]));

    // The base federated graph reflects the regular subgraph's new schema.
    const sdl = await client.getFederatedGraphSDLByName({ name: fedGraph, namespace: DEFAULT_NAMESPACE });
    expect(sdl.sdl).toContain('again');
  });

  test('that an error is returned when the namespace does not exist', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const resp = await client.publishFederatedSubgraphs({
      namespace: 'does-not-exist',
      subgraphs: [{ name: genID('subgraph'), schema: `type Query { a: String }` }],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });

  test('that an error is returned when no subgraphs are provided', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR);
  });

  test('that the same subgraph cannot appear more than once in a request', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const label = genUniqueLabel('team');
    const fedGraph = genID('fedGraph');
    const subgraphA = genID('subgraphA');

    await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String }`,
      [label],
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphA, schema: `type Query { a: String }` },
        { name: subgraphA, schema: `type Query { a: String a2: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.ERR);
    expect(resp.response?.details).toContain(subgraphA);
  });

  test.each(['organization-admin', 'organization-developer', 'subgraph-admin', 'subgraph-publisher'])(
    '%s should be able to batch publish existing subgraphs',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const label = genUniqueLabel('team');
      const fedGraph = genID('fedGraph');
      const subgraphA = genID('subgraphA');

      await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
      await createAndPublishSubgraph(
        client,
        subgraphA,
        DEFAULT_NAMESPACE,
        `type Query { a: String }`,
        [label],
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const resp = await client.publishFederatedSubgraphs({
        namespace: DEFAULT_NAMESPACE,
        subgraphs: [{ name: subgraphA, schema: `type Query { a: String a2: String }` }],
      });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
    },
  );

  test.each(['organization-viewer', 'graph-admin', 'graph-viewer'])(
    '%s should not be able to batch publish existing subgraphs',
    async (role) => {
      const { client, server, authenticator, users } = await SetupTest({ dbname, chClient });
      onTestFinished(() => server.close());

      const label = genUniqueLabel('team');
      const fedGraph = genID('fedGraph');
      const subgraphA = genID('subgraphA');

      await createFederatedGraph(client, fedGraph, DEFAULT_NAMESPACE, [joinLabel(label)], DEFAULT_ROUTER_URL);
      await createAndPublishSubgraph(
        client,
        subgraphA,
        DEFAULT_NAMESPACE,
        `type Query { a: String }`,
        [label],
        DEFAULT_SUBGRAPH_URL_ONE,
      );

      authenticator.changeUserWithSuppliedContext({
        ...users.adminAliceCompanyA,
        rbac: createTestRBACEvaluator(createTestGroup({ role })),
      });

      const resp = await client.publishFederatedSubgraphs({
        namespace: DEFAULT_NAMESPACE,
        subgraphs: [{ name: subgraphA, schema: `type Query { a: String a2: String }` }],
      });

      expect(resp.response?.code).toBe(EnumStatusCode.ERROR_NOT_AUTHORIZED);
    },
  );

  /**
   * A single batch publish that fans out across two federated graphs, a contract, and a feature flag:
   *
   *   - subgraph A        -> fed graph A (+ contract A)
   *   - subgraph B        -> fed graph B            (base subgraph of feature subgraph B)
   *   - subgraph C        -> fed graph A AND fed graph B (+ contract A)
   *   - feature subgraph B -> feature flag A (enabled, on fed graph B)
   *
   * Each affected graph must be composed exactly once even though multiple subgraphs touch it, its contract must be
   * recomposed once, and the feature flag must be recomposed. Verified with split-config-loading both off and on.
   */
  // eslint-disable-next-line unicorn/consistent-function-scoping
  const runFanOutScenario = async (client: Client<typeof PlatformService>) => {
    const labelA = genUniqueLabel('teamA');
    const labelB = genUniqueLabel('teamB');
    const fedGraphA = genID('fedGraphA');
    const fedGraphB = genID('fedGraphB');
    const contractA = genID('contractA');
    const featureFlagA = genID('ffA');
    const subgraphA = genID('subgraphA');
    const subgraphB = genID('subgraphB');
    const subgraphC = genID('subgraphC');
    const featureSubgraphB = genID('featureSubgraphB');

    await createFederatedGraph(client, fedGraphA, DEFAULT_NAMESPACE, [joinLabel(labelA)], DEFAULT_ROUTER_URL);
    await createFederatedGraph(client, fedGraphB, DEFAULT_NAMESPACE, [joinLabel(labelB)], DEFAULT_ROUTER_URL);

    // subgraph A -> fed graph A only (carries a tagged field so contract A has something to exclude).
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String internalA: String @tag(name: "internal") }`,
      [labelA],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    // subgraph B -> fed graph B only; it is the base subgraph for feature subgraph B.
    await createAndPublishSubgraph(
      client,
      subgraphB,
      DEFAULT_NAMESPACE,
      `type Query { b: String }`,
      [labelB],
      DEFAULT_SUBGRAPH_URL_TWO,
    );
    // subgraph C -> both fed graph A and fed graph B.
    await createAndPublishSubgraph(
      client,
      subgraphC,
      DEFAULT_NAMESPACE,
      `type Query { c: String }`,
      [labelA, labelB],
      'http://localhost:4003',
    );

    const createContractRes = await client.createContract({
      name: contractA,
      namespace: DEFAULT_NAMESPACE,
      sourceGraphName: fedGraphA,
      excludeTags: ['internal'],
      routingUrl: 'http://localhost:5001',
    });
    expect(createContractRes.response?.code).toBe(EnumStatusCode.OK);

    // Feature subgraph B (base = subgraph B) inside an enabled feature flag matching fed graph B.
    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphB,
      subgraphB,
      DEFAULT_NAMESPACE,
      `type Query { b: String }`,
      [],
      'http://localhost:4004',
    );
    await createFeatureFlag(client, featureFlagA, [labelB], [featureSubgraphB], DEFAULT_NAMESPACE, true);

    // Baselines captured immediately before the batch. Base-only counts exclude feature-flag compositions so they
    // are comparable across split / non-split modes.
    const aBaseBefore = await getCompositionCount(client, fedGraphA, DEFAULT_NAMESPACE, true);
    const bBaseBefore = await getCompositionCount(client, fedGraphB, DEFAULT_NAMESPACE, true);
    const contractBefore = await getCompositionCount(client, contractA, DEFAULT_NAMESPACE, true);
    const bTotalBefore = await getCompositionCount(client, fedGraphB, DEFAULT_NAMESPACE, false);

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphA, schema: `type Query { a: String a2: String internalA: String @tag(name: "internal") }` },
        { name: subgraphB, schema: `type Query { b: String b2: String }` },
        { name: subgraphC, schema: `type Query { c: String c2: String }` },
        { name: featureSubgraphB, schema: `type Query { b: String bFeature: String }` },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.counts?.compositionErrors).toBe(0);
    expect(resp.counts?.deploymentErrors).toBe(0);
    expect(resp.updatedSubgraphNames).toHaveLength(4);
    expect(resp.updatedSubgraphNames).toEqual(
      expect.arrayContaining([subgraphA, subgraphB, subgraphC, featureSubgraphB]),
    );

    // Each base federated graph is composed exactly once, even though two subgraphs touch each of them.
    expect(await getCompositionCount(client, fedGraphA, DEFAULT_NAMESPACE, true)).toBe(aBaseBefore + 1);
    expect(await getCompositionCount(client, fedGraphB, DEFAULT_NAMESPACE, true)).toBe(bBaseBefore + 1);
    // The contract of fed graph A is recomposed exactly once as part of its source graph.
    expect(await getCompositionCount(client, contractA, DEFAULT_NAMESPACE, true)).toBe(contractBefore + 1);
    // Fed graph B gains exactly two compositions: one base recompose plus one feature-flag composition for the
    // single enabled feature flag whose feature subgraph changed.
    expect(await getCompositionCount(client, fedGraphB, DEFAULT_NAMESPACE, false)).toBe(bTotalBefore + 2);

    // The composed schemas reflect every published change.
    const sdlA = await client.getFederatedGraphSDLByName({ name: fedGraphA, namespace: DEFAULT_NAMESPACE });
    expect(sdlA.sdl).toContain('a2');
    expect(sdlA.sdl).toContain('c2');
    const sdlB = await client.getFederatedGraphSDLByName({ name: fedGraphB, namespace: DEFAULT_NAMESPACE });
    expect(sdlB.sdl).toContain('b2');
    expect(sdlB.sdl).toContain('c2');
    const sdlContract = await client.getFederatedGraphSDLByName({ name: contractA, namespace: DEFAULT_NAMESPACE });
    expect(sdlContract.sdl).toContain('a2');
    // The excluded-tag field is hidden in the contract, confirming the contract was actually recomposed.
    expect(sdlContract.sdl).toContain('@inaccessible');
  };

  test('that a batch publish fans out across graphs, a contract, and a feature flag (non-split config)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    await runFanOutScenario(client);
  });

  test('that a batch publish fans out across graphs, a contract, and a feature flag (split config)', async (testContext) => {
    const { client, server } = await SetupTest({ dbname, chClient, enabledFeatures: ['split-config-loading'] });
    testContext.onTestFinished(() => server.close());

    await runFanOutScenario(client);
  });

  test('that batch publish can be queued and the completion status can be fetched', async (testContext) => {
    const { client, server, queues, users } = await SetupTest({ dbname, chClient });
    testContext.onTestFinished(() => server.close());

    const deleteBatchPublishJobDetailsWorker = createDeleteBatchPublishJobDetailsWorker({
      db: server.db,
      logger: server.log,
      redisConnection: server.redisForWorker,
      lockAdapter: server.lockAdapter,
    });
    testContext.onTestFinished(() => deleteBatchPublishJobDetailsWorker.close());

    const label1 = genUniqueLabel('team1');
    const label2 = genUniqueLabel('team2');
    const fedGraph1 = genID('fedGraph1');
    const fedGraph2 = genID('fedGraph2');
    const subgraphA = genID('subgraphA');
    const subgraphB = genID('subgraphB');

    await createFederatedGraph(client, fedGraph1, DEFAULT_NAMESPACE, [joinLabel(label1)], DEFAULT_ROUTER_URL);
    await createFederatedGraph(client, fedGraph2, DEFAULT_NAMESPACE, [joinLabel(label2)], DEFAULT_ROUTER_URL);
    await createAndPublishSubgraph(
      client,
      subgraphA,
      DEFAULT_NAMESPACE,
      `type Query { a: String }`,
      [label1],
      DEFAULT_SUBGRAPH_URL_ONE,
    );
    await createAndPublishSubgraph(
      client,
      subgraphB,
      DEFAULT_NAMESPACE,
      `type Query { b: String }`,
      [label2],
      DEFAULT_SUBGRAPH_URL_TWO,
    );

    const resp = await client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: subgraphA, schema: `type Query { a: String a2: String }` },
        { name: subgraphB, schema: `type Query { b: String b2: String }` },
      ],
      async: true,
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.counts?.compositionErrors).toBe(0);
    expect(resp.counts?.deploymentErrors).toBe(0);
    expect(resp.updatedSubgraphNames).toHaveLength(0);
    expect(resp.jobId).toBeDefined();

    let statusResp: GetBatchPublishJobStatusResponse;
    for (;;) {
      statusResp = await client.getBatchPublishJobStatus({ jobId: resp.jobId });
      expect(statusResp.response?.code).toBe(EnumStatusCode.OK);
      expect(statusResp.status).not.toBe(BatchPublishJobStatus.FAILED);
      if (statusResp.status === BatchPublishJobStatus.COMPLETED) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(statusResp.status).toBe(BatchPublishJobStatus.COMPLETED);
    expect(statusResp.counts?.compositionErrors).toBe(0);
    expect(statusResp.counts?.deploymentErrors).toBe(0);
    expect(statusResp.updatedSubgraphNames).toHaveLength(2);
    expect(statusResp.updatedSubgraphNames).toEqual(expect.arrayContaining([subgraphA, subgraphB]));

    // Both federated graphs should now contain the published fields.
    const sdl1 = await client.getFederatedGraphSDLByName({ name: fedGraph1, namespace: DEFAULT_NAMESPACE });
    expect(sdl1.sdl).toContain('a2');
    const sdl2 = await client.getFederatedGraphSDLByName({ name: fedGraph2, namespace: DEFAULT_NAMESPACE });
    expect(sdl2.sdl).toContain('b2');

    // Ensure that the job is deleted
    const job = await queues.deleteBatchPublishJobDetailsQueue.addJob({
      jobId: resp.jobId!,
      organizationId: users.adminAliceCompanyA.organizationId,
    });

    await job.changeDelay(0);
    await job.waitUntilFinished(new QueueEvents(job.queueName));

    statusResp = await client.getBatchPublishJobStatus({ jobId: resp.jobId });
    expect(statusResp.response?.code).toBe(EnumStatusCode.ERR_NOT_FOUND);
  });
});
