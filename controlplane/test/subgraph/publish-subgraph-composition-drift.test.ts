import { joinLabel } from '@wundergraph/cosmo-shared';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { addSeconds, formatISO, subDays } from 'date-fns';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import { SubgraphRepository } from '../../src/core/repositories/SubgraphRepository.js';
import {
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
  createThenPublishSubgraph,
  DEFAULT_NAMESPACE,
  SetupTest,
} from '../test-util.js';

let dbname = '';

type TestContext = Awaited<ReturnType<typeof SetupTest>>;

// Stores a schema version the way the first phase of a publish does, without composing, as happens when the
// publish request dies before composition runs.
async function storeSchemaWithoutComposing(ctx: TestContext, subgraphName: string, schema: string) {
  const subgraphRepo = new SubgraphRepository(pino(), ctx.server.db, ctx.users.adminAliceCompanyA.organizationId);
  const subgraph = await subgraphRepo.byName(subgraphName, DEFAULT_NAMESPACE);
  expect(subgraph).toBeDefined();
  await subgraphRepo.addSchemaVersion({ targetId: subgraph!.targetId, subgraphSchema: schema });
}

async function countCompositions(ctx: TestContext, fedGraphName: string, excludeFeatureFlagCompositions = true) {
  const res = await ctx.client.getCompositions({
    fedGraphName,
    namespace: DEFAULT_NAMESPACE,
    startDate: formatISO(subDays(new Date(), 1)),
    endDate: formatISO(addSeconds(new Date(), 5)),
    excludeFeatureFlagCompositions,
    limit: 50,
  });
  expect(res.response?.code).toBe(EnumStatusCode.OK);
  return res.compositions.length;
}

async function countFeatureFlagCompositions(ctx: TestContext, fedGraphName: string) {
  return (await countCompositions(ctx, fedGraphName, false)) - (await countCompositions(ctx, fedGraphName));
}

async function sdlInLatestComposition(ctx: TestContext, subgraphName: string, fedGraphName: string) {
  const res = await ctx.client.getSubgraphSDLFromLatestComposition({
    name: subgraphName,
    fedGraphName,
    namespace: DEFAULT_NAMESPACE,
  });
  expect(res.response?.code).toBe(EnumStatusCode.OK);
  return res.sdl;
}

describe('Publish subgraph after a publish that stored the schema but never composed', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('that republishing the identical schema recomposes the graph', async () => {
    const ctx = await SetupTest({ dbname });
    onTestFinished(() => ctx.server.close());

    const label = genUniqueLabel('team');
    const fedGraphName = genID('fedgraph');
    const subgraphName = genID('subgraph');
    const v1 = 'type Query { hello: String }';
    const v2 = 'type Query { hello: String world: String }';

    await createFederatedGraph(
      ctx.client,
      fedGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(label)],
      'http://localhost:8080',
    );
    await createThenPublishSubgraph(ctx.client, subgraphName, DEFAULT_NAMESPACE, v1, [label], 'http://localhost:4001');

    await storeSchemaWithoutComposing(ctx, subgraphName, v2);
    expect(await sdlInLatestComposition(ctx, subgraphName, fedGraphName)).toBe(v1);

    const publishResp = await ctx.client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: v2,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResp.hasChanged).toBe(true);
    expect(await sdlInLatestComposition(ctx, subgraphName, fedGraphName)).toBe(v2);
  });

  test('that republishing an already composed schema does not recompose', async () => {
    const ctx = await SetupTest({ dbname });
    onTestFinished(() => ctx.server.close());

    const label = genUniqueLabel('team');
    const fedGraphName = genID('fedgraph');
    const subgraphName = genID('subgraph');
    const sdl = 'type Query { hello: String }';

    await createFederatedGraph(
      ctx.client,
      fedGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(label)],
      'http://localhost:8080',
    );
    await createThenPublishSubgraph(ctx.client, subgraphName, DEFAULT_NAMESPACE, sdl, [label], 'http://localhost:4001');
    const compositionsBefore = await countCompositions(ctx, fedGraphName);

    const publishResp = await ctx.client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: sdl,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResp.hasChanged).toBe(false);
    expect(await countCompositions(ctx, fedGraphName)).toBe(compositionsBefore);
  });

  test('that a stored schema which fails composition is composed once, then republishing it is a no-op', async () => {
    const ctx = await SetupTest({ dbname });
    onTestFinished(() => ctx.server.close());

    const label = genUniqueLabel('team');
    const fedGraphName = genID('fedgraph');
    const subgraphAName = genID('subgraph-a');
    const subgraphBName = genID('subgraph-b');
    // Conflicts with subgraph A's non-shareable `Query.a: String`.
    const conflictingSDL = 'type Query { a: Int }';

    await createFederatedGraph(
      ctx.client,
      fedGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(label)],
      'http://localhost:8080',
    );
    await createThenPublishSubgraph(
      ctx.client,
      subgraphAName,
      DEFAULT_NAMESPACE,
      'type Query { a: String }',
      [label],
      'http://localhost:4001',
    );
    await createThenPublishSubgraph(
      ctx.client,
      subgraphBName,
      DEFAULT_NAMESPACE,
      'type Query { b: String }',
      [label],
      'http://localhost:4002',
    );

    await storeSchemaWithoutComposing(ctx, subgraphBName, conflictingSDL);
    const compositionsBefore = await countCompositions(ctx, fedGraphName);

    const firstResp = await ctx.client.publishFederatedSubgraph({
      name: subgraphBName,
      namespace: DEFAULT_NAMESPACE,
      schema: conflictingSDL,
    });
    expect(firstResp.response?.code).toBe(EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED);
    expect(firstResp.hasChanged).toBe(true);
    expect(await countCompositions(ctx, fedGraphName)).toBe(compositionsBefore + 1);

    const secondResp = await ctx.client.publishFederatedSubgraph({
      name: subgraphBName,
      namespace: DEFAULT_NAMESPACE,
      schema: conflictingSDL,
    });
    expect(secondResp.response?.code).toBe(EnumStatusCode.OK);
    expect(secondResp.hasChanged).toBe(false);
    expect(await countCompositions(ctx, fedGraphName)).toBe(compositionsBefore + 1);
  });

  test('that only the graphs whose latest composition missed the stored schema are recomposed', async () => {
    const ctx = await SetupTest({ dbname });
    onTestFinished(() => ctx.server.close());

    const labelA = genUniqueLabel('team-a');
    const labelB = genUniqueLabel('team-b');
    const staleGraphName = genID('stale');
    const freshGraphName = genID('fresh');
    const subgraphName = genID('subgraph');
    const v1 = 'type Query { hello: String }';
    const v2 = 'type Query { hello: String world: String }';

    await createFederatedGraph(
      ctx.client,
      staleGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(labelA)],
      'http://localhost:8080',
    );
    await createFederatedGraph(
      ctx.client,
      freshGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(labelB)],
      'http://localhost:8081',
    );
    await createThenPublishSubgraph(
      ctx.client,
      subgraphName,
      DEFAULT_NAMESPACE,
      v1,
      [labelA, labelB],
      'http://localhost:4001',
    );

    await storeSchemaWithoutComposing(ctx, subgraphName, v2);
    const recomposeResp = await ctx.client.recomposeGraph({
      name: freshGraphName,
      namespace: DEFAULT_NAMESPACE,
      isMonograph: false,
    });
    expect(recomposeResp.response?.code).toBe(EnumStatusCode.OK);

    const staleBefore = await countCompositions(ctx, staleGraphName);
    const freshBefore = await countCompositions(ctx, freshGraphName);

    const publishResp = await ctx.client.publishFederatedSubgraph({
      name: subgraphName,
      namespace: DEFAULT_NAMESPACE,
      schema: v2,
    });

    expect(publishResp.response?.code).toBe(EnumStatusCode.OK);
    expect(publishResp.hasChanged).toBe(true);
    expect(await countCompositions(ctx, staleGraphName)).toBe(staleBefore + 1);
    expect(await countCompositions(ctx, freshGraphName)).toBe(freshBefore);
    expect(await sdlInLatestComposition(ctx, subgraphName, staleGraphName)).toBe(v2);
  });

  test('that a batch publish recomposes for the stale subgraph and reports only it as updated', async () => {
    const ctx = await SetupTest({ dbname });
    onTestFinished(() => ctx.server.close());

    const label = genUniqueLabel('team');
    const fedGraphName = genID('fedgraph');
    const staleName = genID('stale');
    const freshName = genID('fresh');
    const v2 = 'type Query { a: String a2: String }';

    await createFederatedGraph(
      ctx.client,
      fedGraphName,
      DEFAULT_NAMESPACE,
      [joinLabel(label)],
      'http://localhost:8080',
    );
    await createThenPublishSubgraph(
      ctx.client,
      staleName,
      DEFAULT_NAMESPACE,
      'type Query { a: String }',
      [label],
      'http://localhost:4001',
    );
    await createThenPublishSubgraph(
      ctx.client,
      freshName,
      DEFAULT_NAMESPACE,
      'type Query { b: String }',
      [label],
      'http://localhost:4002',
    );

    await storeSchemaWithoutComposing(ctx, staleName, v2);
    const compositionsBefore = await countCompositions(ctx, fedGraphName);

    const resp = await ctx.client.publishFederatedSubgraphs({
      namespace: DEFAULT_NAMESPACE,
      subgraphs: [
        { name: staleName, schema: v2 },
        { name: freshName, schema: 'type Query { b: String }' },
      ],
    });

    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.updatedSubgraphNames).toEqual([staleName]);
    expect(await countCompositions(ctx, fedGraphName)).toBe(compositionsBefore + 1);
    expect(await sdlInLatestComposition(ctx, staleName, fedGraphName)).toBe(v2);
  });

  describe.each([true, false])('with split config loading %s', (splitConfigLoading) => {
    const setup = () => SetupTest({ dbname, enabledFeatures: splitConfigLoading ? ['split-config-loading'] : [] });

    test('that republishing a stale feature subgraph recomposes its feature flag', async () => {
      const ctx = await setup();
      onTestFinished(() => ctx.server.close());

      const label = genUniqueLabel('team');
      const fedGraphName = genID('fedgraph');
      const baseName = genID('base');
      const featureName = genID('feature');
      const v2 = 'type Query { hello: String feature: String more: String }';

      await createFederatedGraph(
        ctx.client,
        fedGraphName,
        DEFAULT_NAMESPACE,
        [joinLabel(label)],
        'http://localhost:8080',
      );
      await createThenPublishSubgraph(
        ctx.client,
        baseName,
        DEFAULT_NAMESPACE,
        'type Query { hello: String }',
        [label],
        'http://localhost:4001',
      );
      await createThenPublishFeatureSubgraph(
        ctx.client,
        featureName,
        baseName,
        DEFAULT_NAMESPACE,
        'type Query { hello: String feature: String }',
        [],
        'http://localhost:4002',
      );
      await createFeatureFlag(ctx.client, genID('flag'), [label], [featureName], DEFAULT_NAMESPACE, true);

      await storeSchemaWithoutComposing(ctx, featureName, v2);
      const baseBefore = await countCompositions(ctx, fedGraphName);
      const flagBefore = await countFeatureFlagCompositions(ctx, fedGraphName);

      const resp = await ctx.client.publishFederatedSubgraph({
        name: featureName,
        namespace: DEFAULT_NAMESPACE,
        schema: v2,
      });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.hasChanged).toBe(true);
      expect(await countFeatureFlagCompositions(ctx, fedGraphName)).toBe(flagBefore + 1);
      expect(await countCompositions(ctx, fedGraphName)).toBe(baseBefore);

      const again = await ctx.client.publishFederatedSubgraph({
        name: featureName,
        namespace: DEFAULT_NAMESPACE,
        schema: v2,
      });
      expect(again.response?.code).toBe(EnumStatusCode.OK);
      expect(again.hasChanged).toBe(false);
    });

    test('that republishing a stale base subgraph recomposes the graph and its feature flag', async () => {
      const ctx = await setup();
      onTestFinished(() => ctx.server.close());

      const label = genUniqueLabel('team');
      const fedGraphName = genID('fedgraph');
      const staleName = genID('stale');
      const replacedName = genID('replaced');
      const featureName = genID('feature');
      const v2 = 'type Query { a: String a2: String }';

      await createFederatedGraph(
        ctx.client,
        fedGraphName,
        DEFAULT_NAMESPACE,
        [joinLabel(label)],
        'http://localhost:8080',
      );
      await createThenPublishSubgraph(
        ctx.client,
        staleName,
        DEFAULT_NAMESPACE,
        'type Query { a: String }',
        [label],
        'http://localhost:4001',
      );
      await createThenPublishSubgraph(
        ctx.client,
        replacedName,
        DEFAULT_NAMESPACE,
        'type Query { b: String }',
        [label],
        'http://localhost:4002',
      );
      await createThenPublishFeatureSubgraph(
        ctx.client,
        featureName,
        replacedName,
        DEFAULT_NAMESPACE,
        'type Query { b: String b2: String }',
        [],
        'http://localhost:4003',
      );
      await createFeatureFlag(ctx.client, genID('flag'), [label], [featureName], DEFAULT_NAMESPACE, true);

      await storeSchemaWithoutComposing(ctx, staleName, v2);
      const baseBefore = await countCompositions(ctx, fedGraphName);
      const flagBefore = await countFeatureFlagCompositions(ctx, fedGraphName);

      const resp = await ctx.client.publishFederatedSubgraph({
        name: staleName,
        namespace: DEFAULT_NAMESPACE,
        schema: v2,
      });

      expect(resp.response?.code).toBe(EnumStatusCode.OK);
      expect(resp.hasChanged).toBe(true);
      expect(await countCompositions(ctx, fedGraphName)).toBe(baseBefore + 1);
      expect(await countFeatureFlagCompositions(ctx, fedGraphName)).toBe(flagBefore + 1);
      expect(await sdlInLatestComposition(ctx, staleName, fedGraphName)).toBe(v2);
    });
  });
});
