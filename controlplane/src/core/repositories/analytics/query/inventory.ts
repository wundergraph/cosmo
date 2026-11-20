import { and, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../../db/schema.js';
import { traced } from '../../../tracing.js';

const DELETED_FLAG = '(deleted flag)';

export interface CompositionInfo {
  createdAt: string;
  featureFlag: string;
}

/**
 * Postgres reference data behind the virtual dimensions: subgraph names, feature-flag compositions and
 * composition metadata. Everything is scoped to one organization; graph IDs passed in are already access-checked.
 */
export interface AnalyticsInventory {
  /** Feature-flag composition versions of these graphs, with their flag names (a deleted flag reads "(deleted flag)"). */
  featureFlagVersions(graphIds: string[]): Promise<{ version: string; flagName: string }[]>;
  /** Every subgraph of the organization, including feature subgraphs. */
  organizationSubgraphs(): Promise<{ id: string; name: string }[]>;
  /** The subgraphs of these graphs, for `includeInactive`. */
  graphSubgraphs(graphIds: string[]): Promise<{ id: string; name: string }[]>;
  /** Creation time and flag of the compositions with these schema version IDs. */
  compositions(versions: string[]): Promise<Map<string, CompositionInfo>>;
}

@traced
export class PostgresAnalyticsInventory implements AnalyticsInventory {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  async featureFlagVersions(graphIds: string[]) {
    if (graphIds.length === 0) {
      return [];
    }
    const rows = await this.db
      .select({
        version: schema.federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
        flagName: schema.featureFlags.name,
      })
      .from(schema.federatedGraphsToFeatureFlagSchemaVersions)
      .leftJoin(
        schema.featureFlags,
        eq(schema.featureFlags.id, schema.federatedGraphsToFeatureFlagSchemaVersions.featureFlagId),
      )
      .where(inArray(schema.federatedGraphsToFeatureFlagSchemaVersions.federatedGraphId, graphIds));
    return rows.map((row) => ({ version: row.version, flagName: row.flagName ?? DELETED_FLAG }));
  }

  organizationSubgraphs() {
    return this.db
      .select({ id: schema.subgraphs.id, name: schema.targets.name })
      .from(schema.subgraphs)
      .innerJoin(schema.targets, eq(schema.targets.id, schema.subgraphs.targetId))
      .where(eq(schema.targets.organizationId, this.organizationId));
  }

  graphSubgraphs(graphIds: string[]) {
    if (graphIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.db
      .selectDistinct({ id: schema.subgraphs.id, name: schema.targets.name })
      .from(schema.subgraphsToFederatedGraph)
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.id, schema.subgraphsToFederatedGraph.subgraphId))
      .innerJoin(schema.targets, eq(schema.targets.id, schema.subgraphs.targetId))
      .where(
        and(
          inArray(schema.subgraphsToFederatedGraph.federatedGraphId, graphIds),
          eq(schema.targets.organizationId, this.organizationId),
        ),
      );
  }

  async compositions(versions: string[]) {
    const result = new Map<string, CompositionInfo>();
    if (versions.length === 0) {
      return result;
    }
    const rows = await this.db
      .select({
        version: schema.graphCompositions.schemaVersionId,
        createdAt: schema.graphCompositions.createdAt,
        flagName: schema.featureFlags.name,
        isFeatureFlagComposition: schema.graphCompositions.isFeatureFlagComposition,
      })
      .from(schema.graphCompositions)
      .innerJoin(schema.schemaVersion, eq(schema.schemaVersion.id, schema.graphCompositions.schemaVersionId))
      .leftJoin(
        schema.federatedGraphsToFeatureFlagSchemaVersions,
        eq(
          schema.federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
          schema.graphCompositions.schemaVersionId,
        ),
      )
      .leftJoin(
        schema.featureFlags,
        eq(schema.featureFlags.id, schema.federatedGraphsToFeatureFlagSchemaVersions.featureFlagId),
      )
      .where(
        and(
          inArray(schema.graphCompositions.schemaVersionId, versions),
          eq(schema.schemaVersion.organizationId, this.organizationId),
        ),
      );
    for (const row of rows) {
      result.set(row.version, {
        createdAt: row.createdAt.toISOString(),
        featureFlag: row.isFeatureFlagComposition ? (row.flagName ?? DELETED_FLAG) : '',
      });
    }
    return result;
  }
}
