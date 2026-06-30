import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SQL, and, count, desc, eq, gt, lt, not, inArray, or, isNull } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import {
  featureFlags,
  federatedGraphsToFeatureFlagSchemaVersions,
  graphCompositions,
  graphCompositionSubgraphs,
  schemaVersion,
  subgraphs,
  users,
} from '../../db/schema.js';
import { DateRange, GraphCompositionDTO } from '../../types/index.js';
import { CompositionSubgraphRecord } from '../composition/composer.js';
import { traced } from '../tracing.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

@traced
export class GraphCompositionRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async addComposition({
    fedGraphTargetId,
    fedGraphSchemaVersionId,
    compositionErrorString,
    compositionWarningString,
    routerConfigSignature,
    composedSubgraphs,
    composedById,
    admissionErrorString,
    deploymentErrorString,
    isFeatureFlagComposition,
    featureFlagId,
    routerCompatibilityVersion,
  }: {
    fedGraphTargetId: string;
    fedGraphSchemaVersionId: string;
    compositionErrorString: string;
    compositionWarningString: string;
    routerConfigSignature?: string;
    composedSubgraphs: CompositionSubgraphRecord[];
    composedById: string;
    admissionErrorString?: string;
    deploymentErrorString?: string;
    isFeatureFlagComposition: boolean;
    featureFlagId: string;
    routerCompatibilityVersion: string;
  }) {
    await this.db.transaction(async (tx) => {
      const actor = await tx.query.users.findFirst({
        where: eq(users.id, composedById),
      });
      if (!actor) {
        throw new Error(`Could not find actor ${composedById}`);
      }

      const subgraphSchemaVersionIds = composedSubgraphs.map((subgraph) => subgraph.schemaVersionId);

      let previousCompositionId: string | undefined;
      if (isFeatureFlagComposition) {
        previousCompositionId = (
          await tx
            .select({ id: graphCompositions.id })
            .from(graphCompositions)
            .innerJoin(
              schemaVersion,
              and(
                eq(schemaVersion.targetId, fedGraphTargetId),
                eq(schemaVersion.id, graphCompositions.schemaVersionId),
              ),
            )
            .innerJoin(
              federatedGraphsToFeatureFlagSchemaVersions,
              and(
                eq(federatedGraphsToFeatureFlagSchemaVersions.featureFlagId, featureFlagId),
                eq(
                  federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
                  graphCompositions.schemaVersionId,
                ),
              ),
            )
            .where(eq(graphCompositions.isFeatureFlagComposition, true))
            .orderBy(desc(graphCompositions.createdAt))
            .limit(1)
            .execute()
        )[0]?.id;
      } else {
        previousCompositionId = (
          await tx
            .select({
              id: graphCompositions.id,
            })
            .from(graphCompositions)
            .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
            .where(
              and(eq(schemaVersion.targetId, fedGraphTargetId), eq(graphCompositions.isFeatureFlagComposition, false)),
            )
            .orderBy(desc(graphCompositions.createdAt))
            .limit(1)
            .execute()
        )[0]?.id;
      }

      const insertedComposition = await tx
        .insert(graphCompositions)
        .values({
          schemaVersionId: fedGraphSchemaVersionId,
          compositionErrors: compositionErrorString,
          compositionWarnings: compositionWarningString,
          isComposable: compositionErrorString === '',
          routerConfigSignature,
          createdById: composedById,
          createdByEmail: actor.email,
          deploymentError: deploymentErrorString,
          admissionError: admissionErrorString,
          isFeatureFlagComposition,
          routerCompatibilityVersion,
        })
        .returning()
        .execute();

      if (subgraphSchemaVersionIds.length > 0) {
        const prevCompositionSubgraphs: {
          id: string;
          name: string;
          schemaVersionId: string;
          targetId: string;
          isFeatureSubgraph: boolean;
        }[] = [];
        if (previousCompositionId) {
          const prevSubgraphs = await tx
            .select({
              id: graphCompositionSubgraphs.subgraphId,
              name: graphCompositionSubgraphs.subgraphName,
              schemaVersionId: graphCompositionSubgraphs.schemaVersionId,
              targetId: graphCompositionSubgraphs.subgraphTargetId,
              isFeatureSubgraph: graphCompositionSubgraphs.isFeatureSubgraph,
            })
            .from(graphCompositionSubgraphs)
            .where(
              and(
                eq(graphCompositionSubgraphs.graphCompositionId, previousCompositionId),
                not(eq(graphCompositionSubgraphs.changeType, 'removed')),
              ),
            )
            .execute();
          prevCompositionSubgraphs.push(...prevSubgraphs);
        }

        const addedSubgraphs: CompositionSubgraphRecord[] = [];
        const updatedSubgraphs: CompositionSubgraphRecord[] = [];
        const unchangedSubgraphs: CompositionSubgraphRecord[] = [];
        for (const subgraph of composedSubgraphs) {
          const prevSubgraph = prevCompositionSubgraphs.find((ps) => ps.id === subgraph.id);
          if (!prevSubgraph) {
            addedSubgraphs.push(subgraph);
            continue;
          }

          if (prevSubgraph.schemaVersionId !== subgraphSchemaVersionIds[composedSubgraphs.indexOf(subgraph)]) {
            updatedSubgraphs.push(subgraph);
            continue;
          }

          unchangedSubgraphs.push(subgraph);
        }

        const removedSubgraphs = prevCompositionSubgraphs.filter(
          (subgraph) => !composedSubgraphs.some((prevSubgraph) => prevSubgraph.id === subgraph.id),
        );

        const insertValues: (typeof graphCompositionSubgraphs.$inferInsert)[] = [
          ...addedSubgraphs,
          ...updatedSubgraphs,
          ...removedSubgraphs,
          ...unchangedSubgraphs,
        ].map((subgraph) => ({
          graphCompositionId: insertedComposition[0].id,
          subgraphId: subgraph.id,
          subgraphTargetId: subgraph.targetId,
          subgraphName: subgraph.name,
          schemaVersionId: subgraph.schemaVersionId,
          isFeatureSubgraph: subgraph.isFeatureSubgraph,
          changeType: (() => {
            if (addedSubgraphs.some((s) => s.id === subgraph.id)) {
              return 'added';
            }
            if (removedSubgraphs.some((s) => s.id === subgraph.id)) {
              return 'removed';
            }
            if (updatedSubgraphs.some((s) => s.id === subgraph.id)) {
              return 'updated';
            }
            return 'unchanged';
          })(),
        }));

        await tx.insert(graphCompositionSubgraphs).values(insertValues).execute();
      }
    });
  }

  public updateComposition({
    fedGraphSchemaVersionId,
    admissionErrorString,
    deploymentErrorString,
    routerConfigSignature,
  }: {
    fedGraphSchemaVersionId: string;
    admissionErrorString?: string;
    deploymentErrorString?: string;
    routerConfigSignature?: string;
  }) {
    return this.db
      .update(graphCompositions)
      .set({
        deploymentError: deploymentErrorString,
        admissionError: admissionErrorString,
        routerConfigSignature,
      })
      .where(eq(graphCompositions.schemaVersionId, fedGraphSchemaVersionId));
  }

  public async getGraphComposition(input: {
    compositionId: string;
    organizationId: string;
  }): Promise<GraphCompositionDTO | undefined> {
    const fedRepo = new FederatedGraphRepository(this.logger, this.db, input.organizationId);

    const compositions = await this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        compositionWarnings: graphCompositions.compositionWarnings,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        createdByEmail: graphCompositions.createdByEmail,
        targetId: schemaVersion.targetId,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
        routerCompatibilityVersion: graphCompositions.routerCompatibilityVersion,
        isFeatureFlagComposition: graphCompositions.isFeatureFlagComposition,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(and(eq(graphCompositions.id, input.compositionId), eq(schemaVersion.organizationId, input.organizationId)))
      .orderBy(desc(schemaVersion.createdAt))
      .execute();

    if (compositions.length === 0) {
      return undefined;
    }

    const composition = compositions[0];
    const featureFlagNamesBySchemaVersionId = await this.getFeatureFlagBySchemaVersionIds(
      composition.isFeatureFlagComposition ? [composition.schemaVersionId] : [],
    );

    const featureFlagInfo = featureFlagNamesBySchemaVersionId.get(composition.schemaVersionId);
    const isCurrentDeployed = await this.isLatestValidComposition({
      fedGraphRepo: fedRepo,
      targetId: composition.targetId,
      featureFlagId: featureFlagInfo?.id,
      composition,
    });

    return {
      id: composition.id,
      schemaVersionId: composition.schemaVersionId,
      targetId: composition.targetId,
      createdAt: composition.createdAt.toISOString(),
      isComposable: composition.isComposable || false,
      compositionErrors: composition.compositionErrors || undefined,
      compositionWarnings: composition.compositionWarnings || undefined,
      createdBy: composition.createdBy || composition.createdByEmail || undefined,
      routerConfigSignature: composition.routerConfigSignature || undefined,
      isLatestValid: isCurrentDeployed,
      admissionError: composition.admissionError || undefined,
      deploymentError: composition.deploymentError || undefined,
      routerCompatibilityVersion: composition.routerCompatibilityVersion,
      isFeatureFlagComposition: composition.isFeatureFlagComposition,
      featureFlagName: featureFlagInfo?.name,
    };
  }

  public async getGraphCompositionBySchemaVersion(input: {
    schemaVersionId: string;
    organizationId: string;
  }): Promise<GraphCompositionDTO | undefined> {
    const fedRepo = new FederatedGraphRepository(this.logger, this.db, input.organizationId);

    const compositions = await this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        createdByEmail: graphCompositions.createdByEmail,
        targetId: schemaVersion.targetId,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
        routerCompatibilityVersion: graphCompositions.routerCompatibilityVersion,
        isFeatureFlagComposition: graphCompositions.isFeatureFlagComposition,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(
        and(
          eq(graphCompositions.schemaVersionId, input.schemaVersionId),
          eq(schemaVersion.organizationId, input.organizationId),
        ),
      )
      .orderBy(desc(schemaVersion.createdAt))
      .execute();

    if (compositions.length === 0) {
      return undefined;
    }

    const composition = compositions[0];
    const featureFlagNamesBySchemaVersionId = await this.getFeatureFlagBySchemaVersionIds(
      composition.isFeatureFlagComposition ? [composition.schemaVersionId] : [],
    );

    const featureFlagInfo = featureFlagNamesBySchemaVersionId.get(composition.schemaVersionId);
    const isCurrentDeployed = await this.isLatestValidComposition({
      fedGraphRepo: fedRepo,
      targetId: composition.targetId,
      featureFlagId: featureFlagInfo?.id,
      composition,
    });

    return {
      id: composition.id,
      schemaVersionId: composition.schemaVersionId,
      targetId: composition.targetId,
      createdAt: composition.createdAt.toISOString(),
      isComposable: composition.isComposable || false,
      compositionErrors: composition.compositionErrors || undefined,
      createdBy: composition.createdBy || composition.createdByEmail || undefined,
      isLatestValid: isCurrentDeployed,
      routerConfigSignature: composition.routerConfigSignature || undefined,
      admissionError: composition.admissionError || undefined,
      deploymentError: composition.deploymentError || undefined,
      routerCompatibilityVersion: composition.routerCompatibilityVersion,
      isFeatureFlagComposition: composition.isFeatureFlagComposition,
      featureFlagName: featureFlagInfo?.name,
    };
  }

  public async getCompositionSubgraphs(input: {
    compositionId: string;
    schemaVersionId: string;
    includeChildCompositionSubgraphs?: boolean;
  }) {
    const compositionSubgraphs = await this.db
      .select({
        id: graphCompositionSubgraphs.subgraphId,
        schemaVersionId: graphCompositionSubgraphs.schemaVersionId,
        name: graphCompositionSubgraphs.subgraphName,
        targetId: graphCompositionSubgraphs.subgraphTargetId,
        isFeatureSubgraph: graphCompositionSubgraphs.isFeatureSubgraph,
        changeType: graphCompositionSubgraphs.changeType,
        subgraphType: subgraphs.type,
      })
      .from(graphCompositionSubgraphs)
      .innerJoin(subgraphs, eq(graphCompositionSubgraphs.subgraphId, subgraphs.id))
      .where(eq(graphCompositionSubgraphs.graphCompositionId, input.compositionId))
      .execute();

    if (!input.includeChildCompositionSubgraphs) {
      return compositionSubgraphs;
    }

    const childCompositionSubgraphs = await this.db
      .select({
        id: graphCompositionSubgraphs.subgraphId,
        schemaVersionId: graphCompositionSubgraphs.schemaVersionId,
        name: graphCompositionSubgraphs.subgraphName,
        targetId: graphCompositionSubgraphs.subgraphTargetId,
        isFeatureSubgraph: graphCompositionSubgraphs.isFeatureSubgraph,
        changeType: graphCompositionSubgraphs.changeType,
        subgraphType: subgraphs.type,
      })
      .from(graphCompositionSubgraphs)
      .innerJoin(
        subgraphs,
        and(eq(graphCompositionSubgraphs.subgraphId, subgraphs.id), eq(subgraphs.isFeatureSubgraph, true)),
      )
      .innerJoin(graphCompositions, eq(graphCompositions.id, graphCompositionSubgraphs.graphCompositionId))
      .innerJoin(
        federatedGraphsToFeatureFlagSchemaVersions,
        eq(federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId, graphCompositions.schemaVersionId),
      )
      .where(eq(federatedGraphsToFeatureFlagSchemaVersions.baseCompositionSchemaVersionId, input.schemaVersionId))
      .execute();

    return [...compositionSubgraphs, ...childCompositionSubgraphs];
  }

  public async getGraphCompositions({
    fedGraphTargetId,
    organizationId,
    limit,
    offset,
    dateRange,
    excludeFeatureFlagCompositions,
  }: {
    fedGraphTargetId: string;
    organizationId: string;
    limit: number;
    offset: number;
    dateRange: DateRange;
    excludeFeatureFlagCompositions: boolean;
  }) {
    const fedRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
    const conditions: SQL<unknown>[] = [
      eq(schemaVersion.targetId, fedGraphTargetId),
      gt(graphCompositions.createdAt, new Date(dateRange.start)),
      lt(graphCompositions.createdAt, new Date(dateRange.end)),
    ];

    if (excludeFeatureFlagCompositions) {
      conditions.push(eq(graphCompositions.isFeatureFlagComposition, false));
    }

    const dbQuery = this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        compositionWarnings: graphCompositions.compositionWarnings,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        createdByEmail: graphCompositions.createdByEmail,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
        routerCompatibilityVersion: graphCompositions.routerCompatibilityVersion,
        isFeatureFlagComposition: graphCompositions.isFeatureFlagComposition,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(and(...conditions))
      .orderBy(desc(schemaVersion.createdAt));

    if (limit) {
      dbQuery.limit(limit);
    }

    if (offset) {
      dbQuery.offset(offset);
    }

    const resp = await dbQuery.execute();
    const featureFlagNamesBySchemaVersionId = await this.getFeatureFlagBySchemaVersionIds(
      resp.filter((r) => r.isFeatureFlagComposition).map((r) => r.schemaVersionId),
    );

    const compositions: (GraphCompositionDTO & {
      hasMultipleChangedSubgraphs: boolean;
      triggeredBySubgraphName: string;
    })[] = [];

    for (const r of resp) {
      const compositionSubgraphs = await this.getCompositionSubgraphs({
        compositionId: r.id,
        schemaVersionId: r.schemaVersionId,
        includeChildCompositionSubgraphs: !r.isFeatureFlagComposition,
      });

      const featureFlagInfo = featureFlagNamesBySchemaVersionId.get(r.schemaVersionId);
      const isCurrentDeployed = await this.isLatestValidComposition({
        fedGraphRepo: fedRepo,
        targetId: fedGraphTargetId,
        featureFlagId: featureFlagInfo?.id,
        composition: r,
      });

      compositions.push({
        id: r.id,
        schemaVersionId: r.schemaVersionId,
        createdAt: r.createdAt.toISOString(),
        isComposable: r.isComposable || false,
        compositionErrors: r.compositionErrors || undefined,
        compositionWarnings: r.compositionWarnings || undefined,
        createdBy: r.createdBy || r.createdByEmail || undefined,
        isLatestValid: isCurrentDeployed,
        routerConfigSignature: r.routerConfigSignature || undefined,
        admissionError: r.admissionError || undefined,
        deploymentError: r.deploymentError || undefined,
        hasMultipleChangedSubgraphs: compositionSubgraphs.filter((s) => s.changeType !== 'unchanged').length > 1,
        triggeredBySubgraphName: compositionSubgraphs.find((s) => s.changeType !== 'unchanged')?.name || '',
        routerCompatibilityVersion: r.routerCompatibilityVersion,
        isFeatureFlagComposition: r.isFeatureFlagComposition,
        featureFlagName: featureFlagInfo?.name,
      });
    }

    return compositions;
  }

  public async getGraphCompositionsCount({
    fedGraphTargetId,
    dateRange,
    excludeFeatureFlagCompositions,
  }: {
    fedGraphTargetId: string;
    dateRange: DateRange;
    excludeFeatureFlagCompositions: boolean;
  }): Promise<number> {
    const conditions: SQL<unknown>[] = [
      eq(schemaVersion.targetId, fedGraphTargetId),
      gt(graphCompositions.createdAt, new Date(dateRange.start)),
      lt(graphCompositions.createdAt, new Date(dateRange.end)),
    ];

    if (excludeFeatureFlagCompositions) {
      conditions.push(eq(graphCompositions.isFeatureFlagComposition, false));
    }

    const compositionsCount = await this.db
      .select({
        count: count(),
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(and(...conditions))
      .execute();

    if (compositionsCount.length === 0) {
      return 0;
    }

    return compositionsCount[0].count;
  }

  private async isLatestValidComposition({
    fedGraphRepo,
    targetId,
    featureFlagId,
    composition: { schemaVersionId, isFeatureFlagComposition },
  }: {
    fedGraphRepo: FederatedGraphRepository;
    targetId: string;
    featureFlagId: string | undefined;
    composition: { schemaVersionId: string; isFeatureFlagComposition: boolean };
  }) {
    if (!isFeatureFlagComposition) {
      return await fedGraphRepo.isLatestValidSchemaVersion(targetId, schemaVersionId);
    }

    if (!featureFlagId) {
      return false;
    }

    const latestValidFeatureFlagVersion = await this.db
      .select({
        id: schemaVersion.id,
      })
      .from(schemaVersion)
      .innerJoin(graphCompositions, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .innerJoin(
        federatedGraphsToFeatureFlagSchemaVersions,
        eq(federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId, schemaVersion.id),
      )
      .where(
        and(
          eq(schemaVersion.targetId, targetId),
          eq(federatedGraphsToFeatureFlagSchemaVersions.featureFlagId, featureFlagId),
          eq(graphCompositions.isFeatureFlagComposition, true),
          eq(graphCompositions.isComposable, true),
          or(isNull(graphCompositions.deploymentError), eq(graphCompositions.deploymentError, '')),
          or(isNull(graphCompositions.admissionError), eq(graphCompositions.admissionError, '')),
        ),
      )
      .orderBy(desc(schemaVersion.createdAt))
      .limit(1)
      .execute();

    return latestValidFeatureFlagVersion?.[0]?.id === schemaVersionId;
  }

  private async getFeatureFlagBySchemaVersionIds(
    composedSchemaVersionIds: string[],
  ): Promise<Map<string, { id: string; name: string }>> {
    const metaBySchemaVersionId = new Map<string, { id: string; name: string }>();
    if (composedSchemaVersionIds.length === 0) {
      return metaBySchemaVersionId;
    }

    const rows = await this.db
      .selectDistinct({
        composedSchemaVersionId: federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId,
        featureFlagId: federatedGraphsToFeatureFlagSchemaVersions.featureFlagId,
        featureFlagName: featureFlags.name,
      })
      .from(federatedGraphsToFeatureFlagSchemaVersions)
      .innerJoin(featureFlags, eq(featureFlags.id, federatedGraphsToFeatureFlagSchemaVersions.featureFlagId))
      .where(inArray(federatedGraphsToFeatureFlagSchemaVersions.composedSchemaVersionId, composedSchemaVersionIds))
      .execute();

    for (const row of rows) {
      if (!row.featureFlagId) {
        continue;
      }

      metaBySchemaVersionId.set(row.composedSchemaVersionId, { id: row.featureFlagId, name: row.featureFlagName });
    }

    return metaBySchemaVersionId;
  }
}
