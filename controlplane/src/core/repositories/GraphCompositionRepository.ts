import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SQL, and, count, desc, eq, gt, lt, not } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { graphCompositions, graphCompositionSubgraphs, schemaVersion, targets, users } from '../../db/schema.js';
import { DateRange, GraphCompositionDTO } from '../../types/index.js';
import { ComposedSubgraph } from '../composition/composer.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

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
    routerCompatibilityVersion,
  }: {
    fedGraphTargetId: string;
    fedGraphSchemaVersionId: string;
    compositionErrorString: string;
    compositionWarningString: string;
    routerConfigSignature?: string;
    composedSubgraphs: ComposedSubgraph[];
    composedById: string;
    admissionErrorString?: string;
    deploymentErrorString?: string;
    isFeatureFlagComposition: boolean;
    routerCompatibilityVersion: string;
  }) {
    await this.db.transaction(async (tx) => {
      const actor = await tx.query.users.findFirst({
        where: eq(users.id, composedById),
      });
      if (!actor) {
        throw new Error(`Could not find actor ${composedById}`);
      }

      const subgraphSchemaVersionIds = composedSubgraphs.map((subgraph) => subgraph.schemaVersionId!);

      const previousComposition = (
        await tx
          .select({
            id: graphCompositions.id,
          })
          .from(graphCompositions)
          .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
          .where(eq(schemaVersion.targetId, fedGraphTargetId))
          .orderBy(desc(graphCompositions.createdAt))
          .limit(1)
          .execute()
      )[0];

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
        if (previousComposition) {
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
                eq(graphCompositionSubgraphs.graphCompositionId, previousComposition.id),
                not(eq(graphCompositionSubgraphs.changeType, 'removed')),
              ),
            )
            .execute();
          prevCompositionSubgraphs.push(...prevSubgraphs);
        }

        const addedSubgraphs = composedSubgraphs.filter(
          (subgraph) => !prevCompositionSubgraphs.some((prevSubgraph) => prevSubgraph.id === subgraph.id),
        );
        const removedSubgraphs = prevCompositionSubgraphs.filter(
          (subgraph) => !composedSubgraphs.some((prevSubgraph) => prevSubgraph.id === subgraph.id),
        );

        const updatedSubgraphs = composedSubgraphs.filter((subgraph) => {
          const prevSubgraph = prevCompositionSubgraphs.find((prevSubgraph) => prevSubgraph.id === subgraph.id);
          return (
            prevSubgraph &&
            prevSubgraph.schemaVersionId !== subgraphSchemaVersionIds[composedSubgraphs.indexOf(subgraph)]
          );
        });

        const unchangedSubgraphs = composedSubgraphs.filter((subgraph) =>
          prevCompositionSubgraphs.some(
            (prevSubgraph) =>
              prevSubgraph.id === subgraph.id &&
              prevSubgraph.schemaVersionId === subgraphSchemaVersionIds[composedSubgraphs.indexOf(subgraph)],
          ),
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
          schemaVersionId: subgraph.schemaVersionId!,
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
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(eq(graphCompositions.id, input.compositionId))
      .orderBy(desc(schemaVersion.createdAt))
      .execute();

    if (compositions.length === 0) {
      return undefined;
    }

    const composition = compositions[0];

    const isCurrentDeployed = await fedRepo.isLatestValidSchemaVersion(
      composition.targetId,
      composition.schemaVersionId,
    );

    return {
      id: composition.id,
      schemaVersionId: composition.schemaVersionId,
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
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(eq(graphCompositions.schemaVersionId, input.schemaVersionId))
      .orderBy(desc(schemaVersion.createdAt))
      .execute();

    if (compositions.length === 0) {
      return undefined;
    }

    const composition = compositions[0];

    const isCurrentDeployed = await fedRepo.isLatestValidSchemaVersion(
      composition.targetId,
      composition.schemaVersionId,
    );

    return {
      id: composition.id,
      schemaVersionId: composition.schemaVersionId,
      createdAt: composition.createdAt.toISOString(),
      isComposable: composition.isComposable || false,
      compositionErrors: composition.compositionErrors || undefined,
      createdBy: composition.createdBy || composition.createdByEmail || undefined,
      isLatestValid: isCurrentDeployed,
      routerConfigSignature: composition.routerConfigSignature || undefined,
      admissionError: composition.admissionError || undefined,
      deploymentError: composition.deploymentError || undefined,
      routerCompatibilityVersion: composition.routerCompatibilityVersion,
    };
  }

  public async getCompositionSubgraphs(input: { compositionId: string }) {
    const res = await this.db
      .select({
        id: graphCompositionSubgraphs.subgraphId,
        schemaVersionId: graphCompositionSubgraphs.schemaVersionId,
        name: graphCompositionSubgraphs.subgraphName,
        targetId: graphCompositionSubgraphs.subgraphTargetId,
        isFeatureSubgraph: graphCompositionSubgraphs.isFeatureSubgraph,
        changeType: graphCompositionSubgraphs.changeType,
      })
      .from(graphCompositionSubgraphs)
      .where(eq(graphCompositionSubgraphs.graphCompositionId, input.compositionId))
      .execute();

    return res;
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

    const compositions: (GraphCompositionDTO & {
      hasMultipleChangedSubgraphs: boolean;
      triggeredBySubgraphName: string;
    })[] = [];

    for (const r of resp) {
      const isCurrentDeployed = await fedRepo.isLatestValidSchemaVersion(fedGraphTargetId, r.schemaVersionId);

      const compositionSubgraphs = await this.getCompositionSubgraphs({ compositionId: r.id });

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
}
