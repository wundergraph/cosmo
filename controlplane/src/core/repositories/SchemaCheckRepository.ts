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
    return this.db.transaction(async (db) => {
      const ops = data.changes.map((change) => {
        return db
          .insert(schemaCheckChangeAction)
          .values({
            schemaCheckId: data.schemaCheckID,
            changeType: change.changeType as SchemaChangeType,
            changeMessage: change.message,
            path: change.path,
            isBreaking: change.isBreaking,
          })
          .execute();
      });
      await Promise.all(ops);
    });
  }

  public createSchemaCheckCompositions(data: { schemaCheckID: string; compositions: ComposedFederatedGraph[] }) {
    let hasCompositionErrors = false;
    return this.db.transaction(async (db) => {
      const ops = data.compositions.map((composition) => {
        if (composition.errors.length > 0) {
          hasCompositionErrors = true;
        }
        return db
          .insert(schemaCheckComposition)
          .values({
            federatedTargetId: composition.targetID,
            schemaCheckId: data.schemaCheckID,
            composedSchemaSDL: composition.composedSchema,
            compositionErrors: composition.errors?.map((e) => e.toString()).join('\n'),
          })
          .execute();
      });
      await Promise.all(ops);
      // update the isComposable column in schema_checks table
      await this.update({
        schemaCheckID: data.schemaCheckID,
        isComposable: !hasCompositionErrors,
      });
    });
  }
}
