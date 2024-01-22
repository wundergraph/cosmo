import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { targets } from '../../db/schema.js';
import { NamespaceRepository } from './NamespaceRepository.js';

export class TargetRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async byName(name: string, namespace: string) {
    const namespaceRepo = new NamespaceRepository(this.db, this.organizationId);
    const ns = await namespaceRepo.byName(namespace);
    if (!ns) {
      throw new Error(`Namespace ${namespace} not found`);
    }

    const target = await this.db
      .select({
        id: targets.id,
        type: targets.type,
        name: targets.name,
      })
      .from(targets)
      .where(
        and(eq(targets.name, name), eq(targets.organizationId, this.organizationId), eq(targets.namespaceId, ns.id)),
      )
      .limit(1)
      .execute();

    if (target.length === 0) {
      return undefined;
    }

    return target[0];
  }

  public async updateReadmeOfTarget(input: { id: string; readme: string }) {
    await this.db
      .update(targets)
      .set({ readme: input.readme })
      .where(and(eq(targets.id, input.id), eq(targets.organizationId, this.organizationId)))
      .execute();
  }
}
