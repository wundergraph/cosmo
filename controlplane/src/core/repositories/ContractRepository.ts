import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ContractDTO } from 'src/types/index.js';
import * as schema from '../../db/schema.js';

export class ContractRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public create(data: {
    sourceFederatedGraphId: string;
    downstreamFederatedGraphId: string;
    includeTags: string[];
    excludeTags: string[];
    actorId: string;
  }) {
    return this.db
      .insert(schema.contracts)
      .values({
        ...data,
        createdById: data.actorId,
      })
      .returning();
  }

  public update(data: { id: string; includeTags: string[]; excludeTags: string[]; actorId: string }) {
    return this.db
      .update(schema.contracts)
      .set({
        ...data,
        updatedById: data.actorId,
        updatedAt: new Date(),
      })
      .where(eq(schema.contracts.id, data.id))
      .returning();
  }

  public delete(id: string) {
    return this.db.delete(schema.contracts).where(eq(schema.contracts.id, id)).returning();
  }

  public async bySourceFederatedGraphId(id: string) {
    const res = await this.db.query.federatedGraphs.findFirst({
      where: eq(schema.federatedGraphs.id, id),
      columns: {
        id: true,
      },
      with: {
        contracts: {
          columns: {
            id: true,
            sourceFederatedGraphId: true,
            downstreamFederatedGraphId: true,
            includeTags: true,
            excludeTags: true,
          },
        },
      },
    });

    return res?.contracts ?? [];
  }
}
