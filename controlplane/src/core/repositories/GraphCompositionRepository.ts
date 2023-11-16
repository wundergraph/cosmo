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
  }: {
    fedGraphSchemaVersionId: string;
    compositionErrorString: string;
    routerConfig?: JsonValue;
    subgraphSchemaVersionIds: string[];
  }) {
    const insertedComposition = await this.db
      .insert(graphCompositions)
      .values({
        schemaVersionId: fedGraphSchemaVersionId,
        routerConfig: routerConfig || null,
        compositionErrors: compositionErrorString,
        isComposable: compositionErrorString === '',
      })
      .returning()
      .execute();
    if (subgraphSchemaVersionIds.length > 0) {
      await this.db
        .insert(graphCompositionSubgraphs)
        .values(
          subgraphSchemaVersionIds.map((schemaVersionId) => ({
            graphCompositionId: insertedComposition[0].id,
            schemaVersionId,
          })),
        )
        .execute();
    }
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
