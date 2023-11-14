import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { graphCompositions, schemaVersion, targets } from '../../db/schema.js';
import { GraphCompositionDTO, SubgraphDTO } from '../../types/index.js';

export class GraphCompositionRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async addComposition(input: { fedGraphSchemaVersionId: string; subgraphSchemaVersionIds: string[] }) {
    if (input.subgraphSchemaVersionIds.length > 0) {
      await this.db
        .insert(graphCompositions)
        .values(
          input.subgraphSchemaVersionIds.map((subgraphSchemaVersionId) => ({
            federatedGraphSchemaVersionId: input.fedGraphSchemaVersionId,
            subgraphSchemaVersionId,
          })),
        )
        .execute();
    }
  }

  public async getComposition(input: { fedGraphSchemaVersionId: string }): Promise<GraphCompositionDTO | undefined> {
    const comspositions = await this.db
      .select({
        federatedGraphSchemaVersionId: graphCompositions.federatedGraphSchemaVersionId,
        subgraphSchemaVersionId: graphCompositions.subgraphSchemaVersionId,
        subgraphTargetId: schemaVersion.targetId,
        subgraphSchema: schemaVersion.schemaSDL,
      })
      .from(graphCompositions)
      .innerJoin(schemaVersion, eq(graphCompositions.subgraphSchemaVersionId, schemaVersion.id))
      .where(eq(graphCompositions.federatedGraphSchemaVersionId, input.fedGraphSchemaVersionId))
      .execute();

    if (comspositions.length === 0) {
      return undefined;
    }

    return {
      federatedGraphSchemaVersionId: comspositions[0].federatedGraphSchemaVersionId,
      subgraphs: comspositions.map((c) => ({
        schemaVersionId: c.subgraphSchemaVersionId,
        targetId: c.subgraphTargetId || '',
        schema: c.subgraphSchema || '',
      })),
    };
  }
}
