import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SQL, and, count, desc, eq, gt, lt } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { splitLabel } from '@wundergraph/cosmo-shared';
import * as schema from '../../db/schema.js';
import { graphCompositions, graphCompositionSubgraphs, schemaVersion, targets, users } from '../../db/schema.js';
import { DateRange, GraphCompositionDTO } from '../../types/index.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export class GraphCompositionRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async addComposition({
    fedGraphSchemaVersionId,
    compositionErrorString,
    routerConfigSignature,
    subgraphSchemaVersionIds,
    composedById,
    admissionErrorString,
    deploymentErrorString,
    isFeatureFlagComposition,
  }: {
    fedGraphSchemaVersionId: string;
    compositionErrorString: string;
    routerConfigSignature?: string;
    subgraphSchemaVersionIds: string[];
    composedById: string;
    admissionErrorString?: string;
    deploymentErrorString?: string;
    isFeatureFlagComposition: boolean;
  }) {
    await this.db.transaction(async (tx) => {
      const actor = await tx.query.users.findFirst({
        where: eq(users.id, composedById),
      });
      if (!actor) {
        throw new Error(`Could not find actor ${composedById}`);
      }

      const insertedComposition = await tx
        .insert(graphCompositions)
        .values({
          schemaVersionId: fedGraphSchemaVersionId,
          compositionErrors: compositionErrorString,
          isComposable: compositionErrorString === '',
          routerConfigSignature,
          createdById: composedById,
          createdByEmail: actor.email,
          deploymentError: deploymentErrorString,
          admissionError: admissionErrorString,
          isFeatureFlagComposition,
        })
        .returning()
        .execute();
      if (subgraphSchemaVersionIds.length > 0) {
        await tx
          .insert(graphCompositionSubgraphs)
          .values(
            subgraphSchemaVersionIds.map((schemaVersionId) => ({
              graphCompositionId: insertedComposition[0].id,
              schemaVersionId,
            })),
          )
          .execute();
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
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        createdByEmail: graphCompositions.createdByEmail,
        targetId: schemaVersion.targetId,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
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
      createdBy: composition.createdBy || composition.createdByEmail || undefined,
      routerConfigSignature: composition.routerConfigSignature || undefined,
      isLatestValid: isCurrentDeployed,
      admissionError: composition.admissionError || undefined,
      deploymentError: composition.deploymentError || undefined,
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
    };
  }

  public async getCompositionSubgraphs(input: { compositionId: string }) {
    const res = await this.db
      .select({
        id: graphCompositionSubgraphs.id,
        targetId: targets.id,
        name: targets.name,
        routingUrl: schema.subgraphs.routingUrl,
        subscriptionUrl: schema.subgraphs.subscriptionUrl,
        subscriptionProtocol: schema.subgraphs.subscriptionProtocol,
        schemaSDL: schemaVersion.schemaSDL,
        schemaVersionId: graphCompositionSubgraphs.schemaVersionId,
        labels: schema.targets.labels,
        namespaceId: schema.namespaces.id,
        namespace: schema.namespaces.name,
        lastUpdatedAt: graphCompositionSubgraphs.createdAt,
        websocketSubprotocol: schema.subgraphs.websocketSubprotocol,
        isEventDrivenGraph: schema.subgraphs.isEventDrivenGraph,
        isFeatureSubgraph: schema.subgraphs.isFeatureSubgraph,
      })
      .from(graphCompositionSubgraphs)
      .innerJoin(graphCompositions, eq(graphCompositions.id, graphCompositionSubgraphs.graphCompositionId))
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositionSubgraphs.schemaVersionId))
      .innerJoin(targets, eq(targets.id, schemaVersion.targetId))
      .innerJoin(schema.subgraphs, eq(schema.subgraphs.targetId, targets.id))
      .innerJoin(schema.namespaces, eq(schema.namespaces.id, targets.namespaceId))
      .where(eq(graphCompositions.id, input.compositionId))
      .execute();

    return res.map((r) => ({
      ...r,
      schemaSDL: r.schemaSDL || '',
      subscriptionUrl: r.subscriptionUrl || '',
      lastUpdatedAt: r.lastUpdatedAt.toISOString(),
      labels: r.labels?.map?.((l) => splitLabel(l)) ?? [],
    }));
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
  }): Promise<GraphCompositionDTO[]> {
    const fedRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);
    const conditions: SQL<unknown>[] = [
      eq(schemaVersion.targetId, fedGraphTargetId),
      gt(graphCompositions.createdAt, new Date(dateRange.start)),
      lt(graphCompositions.createdAt, new Date(dateRange.end)),
    ];

    if (excludeFeatureFlagCompositions) {
      conditions.push(eq(graphCompositions.isFeatureFlagComposition, false));
    }

    const resp = await this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        createdByEmail: graphCompositions.createdByEmail,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdById, users.id))
      .where(and(...conditions))
      .orderBy(desc(schemaVersion.createdAt))
      .limit(limit)
      .offset(offset)
      .execute();

    const compositions: GraphCompositionDTO[] = [];

    for (const r of resp) {
      const isCurrentDeployed = await fedRepo.isLatestValidSchemaVersion(fedGraphTargetId, r.schemaVersionId);

      compositions.push({
        id: r.id,
        schemaVersionId: r.schemaVersionId,
        createdAt: r.createdAt.toISOString(),
        isComposable: r.isComposable || false,
        compositionErrors: r.compositionErrors || undefined,
        createdBy: r.createdBy || r.createdByEmail || undefined,
        isLatestValid: isCurrentDeployed,
        routerConfigSignature: r.routerConfigSignature || undefined,
        admissionError: r.admissionError || undefined,
        deploymentError: r.deploymentError || undefined,
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
