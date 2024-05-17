import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, count, desc, eq, gt, lt } from 'drizzle-orm';
import { JsonValue } from '@bufbuild/protobuf';
import { FastifyBaseLogger } from 'fastify';
import { splitLabel } from '@wundergraph/cosmo-shared';
import * as schema from '../../db/schema.js';
import { graphCompositions, graphCompositionSubgraphs, schemaVersion, targets, users } from '../../db/schema.js';
import { DateRange, GraphCompositionDTO, SubgraphDTO } from '../../types/index.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export class GraphCompositionRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
  ) {}

  public async addComposition({
    fedGraphSchemaVersionId,
    compositionErrorString,
    routerConfig,
    routerConfigSignature,
    subgraphSchemaVersionIds,
    composedBy,
    admissionErrorString,
    deploymentErrorString,
  }: {
    fedGraphSchemaVersionId: string;
    compositionErrorString: string;
    routerConfig?: JsonValue;
    routerConfigSignature?: string;
    subgraphSchemaVersionIds: string[];
    composedBy: string;
    admissionErrorString?: string;
    deploymentErrorString?: string;
  }) {
    await this.db.transaction(async (tx) => {
      const insertedComposition = await tx
        .insert(graphCompositions)
        .values({
          schemaVersionId: fedGraphSchemaVersionId,
          routerConfig: routerConfig || null,
          compositionErrors: compositionErrorString,
          isComposable: compositionErrorString === '',
          routerConfigSignature,
          createdBy: composedBy,
          deploymentError: deploymentErrorString,
          admissionError: admissionErrorString,
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
        targetId: schemaVersion.targetId,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdBy, users.id))
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
      createdBy: composition.createdBy || undefined,
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
        targetId: schemaVersion.targetId,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdBy, users.id))
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
      createdBy: composition.createdBy || undefined,
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
  }: {
    fedGraphTargetId: string;
    organizationId: string;
    limit: number;
    offset: number;
    dateRange: DateRange;
  }): Promise<GraphCompositionDTO[]> {
    const fedRepo = new FederatedGraphRepository(this.logger, this.db, organizationId);

    const resp = await this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        routerConfigSignature: graphCompositions.routerConfigSignature,
        admissionError: graphCompositions.admissionError,
        deploymentError: graphCompositions.deploymentError,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdBy, users.id))
      .where(
        and(
          eq(schemaVersion.targetId, fedGraphTargetId),
          gt(graphCompositions.createdAt, new Date(dateRange.start)),
          lt(graphCompositions.createdAt, new Date(dateRange.end)),
        ),
      )
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
        createdBy: r.createdBy || undefined,
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
  }: {
    fedGraphTargetId: string;
    dateRange: DateRange;
  }): Promise<number> {
    const compositionsCount = await this.db
      .select({
        count: count(),
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositions.schemaVersionId))
      .leftJoin(users, eq(graphCompositions.createdBy, users.id))
      .where(
        and(
          eq(schemaVersion.targetId, fedGraphTargetId),
          gt(graphCompositions.createdAt, new Date(dateRange.start)),
          lt(graphCompositions.createdAt, new Date(dateRange.end)),
        ),
      )
      .execute();

    if (compositionsCount.length === 0) {
      return 0;
    }

    return compositionsCount[0].count;
  }
}
