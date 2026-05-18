import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { afterAllSetup, beforeAllSetup, genID, genUniqueLabel } from '../../src/core/test-util.js';
import {
  federatedGraphsToFeatureFlagSchemaVersions,
  graphCompositions,
  schemaVersion,
} from '../../src/db/schema.js';
import {
  DEFAULT_ROUTER_URL,
  DEFAULT_SUBGRAPH_URL_ONE,
  SetupTest,
  createAndPublishSubgraph,
  createFeatureFlag,
  createFederatedGraph,
  createThenPublishFeatureSubgraph,
} from '../test-util.js';

let dbname = '';

describe('GetCacheCohortConfigVersions', () => {
  beforeAll(async () => {
    dbname = await beforeAllSetup();
  });

  afterAll(async () => {
    await afterAllSetup(dbname);
  });

  test('returns historical config versions for a (graph, flag) cohort, newest first, and isolates cohorts', async (testContext) => {
    const { client, server, users } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const labels = [genUniqueLabel()];
    const subgraphName = genID('subgraph');
    const featureSubgraphName = genID('feature-subgraph');
    const fedGraphAName = genID('fedGraphA');
    const fedGraphBName = genID('fedGraphB');
    const flagName = genID('flag');

    // Base subgraph + feature subgraph so we have valid material for the flag.
    await createAndPublishSubgraph(
      client,
      subgraphName,
      'default',
      'type Query { hello: String! }',
      labels,
      DEFAULT_SUBGRAPH_URL_ONE,
    );

    await createThenPublishFeatureSubgraph(
      client,
      featureSubgraphName,
      subgraphName,
      'default',
      'type Query { hello: String! world: String! }',
      labels,
      'http://localhost:4101',
    );

    const fedGraphLabels = labels.map(({ key, value }) => `${key}=${value}`);
    await createFederatedGraph(client, fedGraphAName, 'default', fedGraphLabels, DEFAULT_ROUTER_URL);
    await createFederatedGraph(client, fedGraphBName, 'default', fedGraphLabels, DEFAULT_ROUTER_URL);

    await createFeatureFlag(client, flagName, labels, [featureSubgraphName], 'default', true);

    const fedGraphAResp = await client.getFederatedGraphByName({ name: fedGraphAName, namespace: 'default' });
    expect(fedGraphAResp.response?.code).toBe(EnumStatusCode.OK);
    const fedGraphA = fedGraphAResp.graph;
    if (!fedGraphA) {
      throw new Error('expected fedGraphA');
    }

    const fedGraphBResp = await client.getFederatedGraphByName({ name: fedGraphBName, namespace: 'default' });
    expect(fedGraphBResp.response?.code).toBe(EnumStatusCode.OK);
    const fedGraphB = fedGraphBResp.graph;
    if (!fedGraphB) {
      throw new Error('expected fedGraphB');
    }

    const flagResp = await client.getFeatureFlagByName({ name: flagName, namespace: 'default' });
    expect(flagResp.response?.code).toBe(EnumStatusCode.OK);
    const flag = flagResp.featureFlag;
    if (!flag) {
      throw new Error('expected feature flag');
    }

    const organizationId = users.adminAliceCompanyA.organizationId;
    const db = server.db;

    // Strip every fgffsv row AND every prior graph_compositions row for these
    // two graphs' targets so the fixture controls the entire surface. Real
    // graph creation already produces an initial main composition; without
    // this cleanup it would mix with the rows we mint below and break the
    // strict-equality assertions.
    await db.delete(federatedGraphsToFeatureFlagSchemaVersions).execute();
    const existingForFixtureTargets = await db
      .select({ id: schemaVersion.id })
      .from(schemaVersion)
      .where(inArray(schemaVersion.targetId, [fedGraphA.targetId, fedGraphB.targetId]))
      .execute();
    if (existingForFixtureTargets.length > 0) {
      await db
        .delete(graphCompositions)
        .where(
          inArray(
            graphCompositions.schemaVersionId,
            existingForFixtureTargets.map((row) => row.id),
          ),
        )
        .execute();
    }

    // Main compositions live in `graph_compositions` JOIN `schema_versions` on
    // the federated graph's target. They never have a row in fgffsv — that
    // table is exclusively for flag-composition history.
    const mintMainComposition = async (targetId: string, createdAt: Date): Promise<string> => {
      const composedSchemaVersionId = randomUUID();
      await db
        .insert(schemaVersion)
        .values({
          id: composedSchemaVersionId,
          organizationId,
          targetId,
          schemaSDL: 'type Query { hello: String! }',
        })
        .execute();
      await db
        .insert(graphCompositions)
        .values({
          schemaVersionId: composedSchemaVersionId,
          isComposable: true,
          isFeatureFlagComposition: false,
          createdAt,
        })
        .execute();
      return composedSchemaVersionId;
    };

    // Flag compositions land in BOTH graph_compositions (with
    // is_feature_flag_composition=true) AND fgffsv (linking the flag id).
    // Pass featureFlagId=null to simulate the ON DELETE SET NULL orphan that
    // a flag tear-down leaves behind — the fgffsv row survives but the link
    // is severed.
    const mintFlagComposition = async (params: {
      federatedGraphId: string;
      targetId: string;
      featureFlagId: string | null;
      baseCompositionSchemaVersionId: string;
      createdAt: Date;
    }): Promise<string> => {
      const composedSchemaVersionId = randomUUID();
      await db
        .insert(schemaVersion)
        .values({
          id: composedSchemaVersionId,
          organizationId,
          targetId: params.targetId,
          schemaSDL: 'type Query { hello: String! }',
        })
        .execute();
      await db
        .insert(graphCompositions)
        .values({
          schemaVersionId: composedSchemaVersionId,
          isComposable: true,
          isFeatureFlagComposition: true,
          createdAt: params.createdAt,
        })
        .execute();
      await db
        .insert(federatedGraphsToFeatureFlagSchemaVersions)
        .values({
          federatedGraphId: params.federatedGraphId,
          baseCompositionSchemaVersionId: params.baseCompositionSchemaVersionId,
          composedSchemaVersionId,
          featureFlagId: params.featureFlagId,
        })
        .execute();
      return composedSchemaVersionId;
    };

    // The fgffsv `base_composition_schema_version_id` only needs to be a valid
    // schema_versions.id; reuse one per graph to keep PK
    // (graph, base, composed) unique while sharing the base column.
    const baseForA = await mintMainComposition(fedGraphA.targetId, new Date('2023-12-01T00:00:00Z'));
    const baseForB = await mintMainComposition(fedGraphB.targetId, new Date('2023-12-01T00:00:00Z'));

    // 2 main compositions for fedGraphA. These are the rows the main cohort
    // must return — they live only in graph_compositions, not in fgffsv.
    const aMainOlder = await mintMainComposition(fedGraphA.targetId, new Date('2024-03-01T00:00:00Z'));
    const aMainNewer = await mintMainComposition(fedGraphA.targetId, new Date('2024-04-01T00:00:00Z'));

    // 2 flag compositions for (fedGraphA, flag). These are the rows the flag
    // cohort must return.
    const aFlagOlder = await mintFlagComposition({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: flag.id,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    const aFlagNewer = await mintFlagComposition({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: flag.id,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-02-01T00:00:00Z'),
    });

    // 1 cross-graph flag composition that must not leak into A's cohort.
    const bFlag = await mintFlagComposition({
      federatedGraphId: fedGraphB.id,
      targetId: fedGraphB.targetId,
      featureFlagId: flag.id,
      baseCompositionSchemaVersionId: baseForB,
      createdAt: new Date('2024-05-01T00:00:00Z'),
    });

    // 1 orphan: a flag composition whose flag was torn down. Its fgffsv row
    // survives with feature_flag_id=NULL (ON DELETE SET NULL) but
    // graph_compositions still records isFeatureFlagComposition=true. The
    // orphan must NOT appear in the main cohort (different table), nor in
    // any specific flag cohort (no live flag id to match).
    const aFlagOrphan = await mintFlagComposition({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: null,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-06-01T00:00:00Z'),
    });

    // Cohort = (A, F): exactly the 2 flag rows, newest first. The orphan and
    // the cross-graph row must not appear.
    const flagCohort = await client.getCacheCohortConfigVersions({
      federatedGraphId: fedGraphA.id,
      featureFlagId: flag.id,
    });
    expect(flagCohort.response?.code).toBe(EnumStatusCode.OK);
    expect(flagCohort.configVersions).toEqual([aFlagNewer, aFlagOlder]);
    expect(flagCohort.configVersions).not.toContain(aFlagOrphan);
    expect(flagCohort.configVersions).not.toContain(bFlag);

    // Cohort = (A, main): exactly the 2 main compositions, newest first. The
    // base composition from before the test window also belongs to main, so
    // it appears at the tail. Flag rows (live and orphan) must NOT appear.
    const baseCohort = await client.getCacheCohortConfigVersions({
      federatedGraphId: fedGraphA.id,
    });
    expect(baseCohort.response?.code).toBe(EnumStatusCode.OK);
    expect(baseCohort.configVersions).toEqual([aMainNewer, aMainOlder, baseForA]);
    expect(baseCohort.configVersions).not.toContain(aFlagNewer);
    expect(baseCohort.configVersions).not.toContain(aFlagOlder);
    expect(baseCohort.configVersions).not.toContain(aFlagOrphan);
    expect(baseCohort.configVersions).not.toContain(bFlag);

    // Cross-graph sanity: cohort = (B, F) returns only the B row.
    const otherFlagCohort = await client.getCacheCohortConfigVersions({
      federatedGraphId: fedGraphB.id,
      featureFlagId: flag.id,
    });
    expect(otherFlagCohort.response?.code).toBe(EnumStatusCode.OK);
    expect(otherFlagCohort.configVersions).toEqual([bFlag]);
  });

  test('returns an empty list when the cohort has no recorded versions', async (testContext) => {
    const { client, server } = await SetupTest({ dbname });
    testContext.onTestFinished(() => server.close());

    const resp = await client.getCacheCohortConfigVersions({
      federatedGraphId: randomUUID(),
    });
    expect(resp.response?.code).toBe(EnumStatusCode.OK);
    expect(resp.configVersions).toEqual([]);
  });
});
