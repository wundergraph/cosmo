import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { desc, eq, gt, lt, and } from 'drizzle-orm';
import { JsonValue } from '@bufbuild/protobuf';
import * as schema from '../../db/schema.js';
import { graphCompositionSubgraphs, graphCompositions, schemaVersion, targets, users } from '../../db/schema.js';
import { DateRange, GraphCompositionDTO } from '../../types/index.js';
import { FederatedGraphRepository } from './FederatedGraphRepository.js';

export class GraphCompositionRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async addComposition({
    fedGraphSchemaVersionId,
    compositionErrorString,
    routerConfig,
    subgraphSchemaVersionIds,
    composedBy,
  }: {
    fedGraphSchemaVersionId: string;
    compositionErrorString: string;
    routerConfig?: JsonValue;
    subgraphSchemaVersionIds: string[];
    composedBy: string;
  }) {
    await this.db.transaction(async (tx) => {
      const insertedComposition = await tx
        .insert(graphCompositions)
        .values({
          schemaVersionId: fedGraphSchemaVersionId,
          routerConfig: routerConfig || null,
          compositionErrors: compositionErrorString,
          isComposable: compositionErrorString === '',
          createdBy: composedBy,
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
    const fedRepo = new FederatedGraphRepository(this.db, input.organizationId);

    const compositions = await this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
        targetId: schemaVersion.targetId,
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
      isLatestValid: isCurrentDeployed,
    };
  }

  public async getCompositionSubgraphs(input: { compositionId: string }) {
    const compositionSubgraphs = await this.db
      .select({
        id: graphCompositionSubgraphs.id,
        schemaVersionId: graphCompositionSubgraphs.schemaVersionId,
        name: targets.name,
        targetId: targets.id,
      })
      .from(graphCompositionSubgraphs)
      .innerJoin(graphCompositions, eq(graphCompositions.id, graphCompositionSubgraphs.graphCompositionId))
      .innerJoin(schemaVersion, eq(schemaVersion.id, graphCompositionSubgraphs.schemaVersionId))
      .innerJoin(targets, eq(targets.id, schemaVersion.targetId))
      .where(eq(graphCompositions.id, input.compositionId))
      .execute();

    return compositionSubgraphs;
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
    const fedRepo = new FederatedGraphRepository(this.db, organizationId);

    const resp = await this.db
      .select({
        id: graphCompositions.id,
        schemaVersionId: graphCompositions.schemaVersionId,
        isComposable: graphCompositions.isComposable,
        compositionErrors: graphCompositions.compositionErrors,
        createdAt: graphCompositions.createdAt,
        createdBy: users.email,
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
      });
    }

    return compositions;
  }
}
