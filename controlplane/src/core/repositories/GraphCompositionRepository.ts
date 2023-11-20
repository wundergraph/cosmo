import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { JsonValue } from '@bufbuild/protobuf';
import * as schema from '../../db/schema.js';
import { graphCompositionSubgraphs, graphCompositions, schemaVersion, targets } from '../../db/schema.js';

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

  public async getComposition(input: { fedGraphSchemaVersionId: string }) {
    const compositions = await this.db
      .select({
        id: graphCompositions.id,
        isComposable: graphCompositions.isComposable,
        compostionErrors: graphCompositions.compositionErrors,
      })
      .from(graphCompositions)
      .where(eq(graphCompositions.schemaVersionId, input.fedGraphSchemaVersionId))
      .execute();

    if (compositions.length === 0) {
      return undefined;
    }

    return compositions[0];
  }
}
