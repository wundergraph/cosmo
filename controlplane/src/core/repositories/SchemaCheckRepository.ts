import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { SchemaChange } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import * as schema from '../../db/schema.js';
import { schemaCheckChangeAction, schemaCheckComposition, schemaChecks } from '../../db/schema.js';
import { SchemaChangeType } from '../../types/index.js';
import { ComposedFederatedGraph } from '../composition/composer.js';

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
    hasBreakingChanges?: boolean;
  }): Promise<string | undefined> {
    const updatedSchemaCheck = await this.db
      .update(schemaChecks)
      .set({
        isComposable: data.isComposable,
        hasBreakingChanges: data.hasBreakingChanges,
      })
      .where(eq(schemaChecks.id, data.schemaCheckID))
      .returning()
      .execute();
    return updatedSchemaCheck[0].id;
  }

  public createSchemaCheckChanges(data: { schemaCheckID: string; changes: SchemaChange[] }) {
    if (data.changes.length === 0) {
      return;
    }

    return this.db.transaction(async (tx) => {
      await tx
        .insert(schemaCheckChangeAction)
        .values(
          data.changes.map((change) => ({
            schemaCheckId: data.schemaCheckID,
            changeType: change.changeType as SchemaChangeType,
            changeMessage: change.message,
            path: change.path,
            isBreaking: change.isBreaking,
          })),
        )
        .execute();
    });
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
