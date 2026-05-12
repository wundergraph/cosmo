import { randomUUID } from 'node:crypto';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
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

    // Truncate any rows that real publish/compose flows produced so the test
    // controls the entire fixture set for this graph + flag.
    await db.delete(federatedGraphsToFeatureFlagSchemaVersions).execute();

    // Helper that mints a schemaVersion + graphCompositions row with a
    // deterministic createdAt, then links it to the (graph, flag) cohort.
    // `isFeatureFlagComposition` defaults to (featureFlagId !== null) — that's
    // the real-world invariant — but it can be overridden to simulate the
    // ON DELETE SET NULL orphan case: an originally-flag composition whose
    // link to the flag was severed when the flag was torn down.
    const mintCohortRow = async (params: {
      federatedGraphId: string;
      targetId: string;
      featureFlagId: string | null;
      baseCompositionSchemaVersionId: string;
      createdAt: Date;
      isFeatureFlagComposition?: boolean;
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
          isFeatureFlagComposition: params.isFeatureFlagComposition ?? params.featureFlagId !== null,
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

    // The base composition row's id only needs to be a valid schema_versions.id
    // referenced by the FK; reuse a single one per (graph, cohort) tuple to keep
    // the PK (graph, base, composed) unique while sharing the base column.
    const mintBaseSchemaVersion = async (targetId: string): Promise<string> => {
      const id = randomUUID();
      await db
        .insert(schemaVersion)
        .values({
          id,
          organizationId,
          targetId,
          schemaSDL: 'type Query { hello: String! }',
        })
        .execute();
      return id;
    };

    const baseForA = await mintBaseSchemaVersion(fedGraphA.targetId);
    const baseForB = await mintBaseSchemaVersion(fedGraphB.targetId);

    // 2 rows: federated_graph_id=A, feature_flag_id=F
    const aFlagOlder = await mintCohortRow({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: flag.id,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    const aFlagNewer = await mintCohortRow({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: flag.id,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-02-01T00:00:00Z'),
    });

    // 2 rows: federated_graph_id=A, feature_flag_id=NULL (base cohort)
    const aBaseOlder = await mintCohortRow({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: null,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-03-01T00:00:00Z'),
    });
    const aBaseNewer = await mintCohortRow({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: null,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-04-01T00:00:00Z'),
    });

    // 1 row: federated_graph_id=B, feature_flag_id=F (cross-graph; must not leak in).
    const bFlag = await mintCohortRow({
      federatedGraphId: fedGraphB.id,
      targetId: fedGraphB.targetId,
      featureFlagId: flag.id,
      baseCompositionSchemaVersionId: baseForB,
      createdAt: new Date('2024-05-01T00:00:00Z'),
    });

    // 1 row: federated_graph_id=A, feature_flag_id=NULL (because the flag was
    // torn down — ON DELETE SET NULL), but the composition itself was originally
    // for a flag. The pre-fix handler matched this row as part of the main cohort
    // because it filtered on feature_flag_id IS NULL; the fixed handler must
    // exclude it via is_feature_flag_composition = true.
    const aFlagOrphan = await mintCohortRow({
      federatedGraphId: fedGraphA.id,
      targetId: fedGraphA.targetId,
      featureFlagId: null,
      isFeatureFlagComposition: true,
      baseCompositionSchemaVersionId: baseForA,
      createdAt: new Date('2024-06-01T00:00:00Z'),
    });

    // Cohort = (A, F): exactly the 2 flag rows, newest first.
    const flagCohort = await client.getCacheCohortConfigVersions({
      federatedGraphId: fedGraphA.id,
      featureFlagId: flag.id,
    });
    expect(flagCohort.response?.code).toBe(EnumStatusCode.OK);
    expect(flagCohort.configVersions).toEqual([aFlagNewer, aFlagOlder]);
    expect(flagCohort.configVersions).not.toContain(bFlag);

    // Cohort = (A, base): exactly the 2 NULL-flag rows, newest first. The
    // orphaned flag composition (NULL feature_flag_id but
    // is_feature_flag_composition = true) must NOT appear here.
    const baseCohort = await client.getCacheCohortConfigVersions({
      federatedGraphId: fedGraphA.id,
    });
    expect(baseCohort.response?.code).toBe(EnumStatusCode.OK);
    expect(baseCohort.configVersions).toEqual([aBaseNewer, aBaseOlder]);
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
