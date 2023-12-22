import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { targets } from '../../db/schema.js';

export class TargetRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async byName(name: string) {
    const target = await this.db
      .select({
        id: targets.id,
        name: targets.name,
        type: targets.type,
      })
      .from(targets)
      .where(and(eq(targets.name, name), eq(targets.organizationId, this.organizationId)))
      .limit(1)
      .execute();

    if (target.length === 0) {
      return undefined;
    }

    return target[0];
  }

  public async updateReadmeOfTarget(input: { name: string; readme: string }) {
    await this.db
      .update(targets)
      .set({ readme: input.readme })
      .where(and(eq(targets.name, input.name), eq(targets.organizationId, this.organizationId)))
      .execute();
  }
}
