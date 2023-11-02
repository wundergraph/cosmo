import { and, eq, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import {
  schemaCheckChangeAction,
  schemaCheckChangeActionOperationUsage,
  schemaCheckComposition,
  schemaChecks,
} from '../../db/schema.js';
import { ComposedFederatedGraph } from '../composition/composer.js';
import { SchemaDiff } from '../composition/schemaCheck.js';
import { NewSchemaChangeOperationUsage } from '../../db/models.js';
import { InspectorOperationResult } from '../services/SchemaUsageTrafficInspector.js';

export class SchemaCheckRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async create(data: {
    targetId: string;
    isComposable?: boolean;
    proposedSubgraphSchemaSDL: string;
  }): Promise<string> {
    const insertedSchemaCheck = await this.db
      .insert(schemaChecks)
      .values({
        targetId: data.targetId,
        isComposable: data.isComposable,
        proposedSubgraphSchemaSDL: data.proposedSubgraphSchemaSDL,
      })
      .returning()
      .execute();
    return insertedSchemaCheck[0].id;
  }

  public async update(data: {
    schemaCheckID: string;
    isComposable?: boolean;
    hasClientTraffic?: boolean;
    hasBreakingChanges?: boolean;
  }): Promise<string | undefined> {
    const updatedSchemaCheck = await this.db
      .update(schemaChecks)
      .set({
        isComposable: data.isComposable,
        hasBreakingChanges: data.hasBreakingChanges,
        hasClientTraffic: data.hasClientTraffic,
      })
      .where(eq(schemaChecks.id, data.schemaCheckID))
      .returning()
      .execute();
    return updatedSchemaCheck[0].id;
  }

  public createSchemaCheckChanges(data: { schemaCheckID: string; changes: SchemaDiff[] }) {
    if (data.changes.length === 0) {
      return [];
    }
    return this.db
      .insert(schemaCheckChangeAction)
      .values(
        data.changes.map((change) => ({
          schemaCheckId: data.schemaCheckID,
          changeType: change.changeType,
          changeMessage: change.message,
          path: change.path,
          isBreaking: change.isBreaking,
        })),
      )
      .returning();
  }

  public async createOperationUsage(schemaCheckActionOperations: Map<string, InspectorOperationResult[]>) {
    const values: NewSchemaChangeOperationUsage[] = [];

    for (const [schemaCheckChangeActionId, operations] of schemaCheckActionOperations.entries()) {
      values.push(
        ...operations.map((op) => ({
          schemaCheckChangeActionId,
          name: op.name,
          type: op.type,
          hash: op.hash,
          firstSeenAt: op.firstSeenAt,
          lastSeenAt: op.lastSeenAt,
        })),
      );
    }

    if (values.length === 0) {
      return;
    }

    await this.db.insert(schemaCheckChangeActionOperationUsage).values(values).execute();
  }

  public async createCheckedFederatedGraph(schemaCheckId: string, federatedGraphId: string, trafficCheckDays: number) {
    await this.db
      .insert(schema.schemaCheckFederatedGraphs)
      .values({
        checkId: schemaCheckId,
        federatedGraphId,
        trafficCheckDays,
      })
      .execute();
  }

  public async getAffectedOperationsByCheckId(checkId: string) {
    const changeActionIds = (
      await this.db.query.schemaCheckChangeAction.findMany({
        where: and(
          eq(schema.schemaCheckChangeAction.schemaCheckId, checkId),
          eq(schema.schemaCheckChangeAction.isBreaking, true),
        ),
        columns: {
          id: true,
        },
      })
    ).map((r) => r.id);

    if (changeActionIds.length > 0) {
      return await this.db
        .selectDistinctOn([schema.schemaCheckChangeActionOperationUsage.hash], {
          hash: schema.schemaCheckChangeActionOperationUsage.hash,
          name: schema.schemaCheckChangeActionOperationUsage.name,
          type: schema.schemaCheckChangeActionOperationUsage.type,
          firstSeenAt: sql<Date>`min(${schema.schemaCheckChangeActionOperationUsage.firstSeenAt})`,
          lastSeenAt: sql<Date>`max(${schema.schemaCheckChangeActionOperationUsage.lastSeenAt})`,
          schemaChangeIds: sql<
            string[]
          >`array_agg(${schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId})`,
        })
        .from(schema.schemaCheckChangeActionOperationUsage)
        .where(inArray(schema.schemaCheckChangeActionOperationUsage.schemaCheckChangeActionId, changeActionIds))
        .groupBy(({ hash, name, type }) => [hash, name, type]);
    }

    return [];
  }

  public createSchemaCheckCompositions(data: { schemaCheckID: string; compositions: ComposedFederatedGraph[] }) {
    if (data.compositions.length === 0) {
      return;
    }

    return this.db.transaction(async (tx) => {
      // let's check if the subgraph change has produced any composition error.
      // In that case, we will mark all checks as not composable
      const hasCompositionErrors = data.compositions.some((composition) => composition.errors.length > 0);

      await tx
        .insert(schemaCheckComposition)
        .values(
          data.compositions.map((composition) => ({
            federatedTargetId: composition.targetID,
            schemaCheckId: data.schemaCheckID,
            composedSchemaSDL: composition.composedSchema,
            compositionErrors: composition.errors?.map((e) => e.toString()).join('\n'),
          })),
        )
        .execute();

      // update the isComposable column in schema_checks table
      await tx
        .update(schemaChecks)
        .set({
          isComposable: !hasCompositionErrors,
        })
        .where(eq(schemaChecks.id, data.schemaCheckID))
        .returning()
        .execute();
    });
  }
}
