import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { and, eq, count } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { subgraphs, targets } from '../../db/schema.js';

export class PluginRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async count(opts: { namespaceId: string }): Promise<number> {
    const pluginCount = await this.db
      .select({ count: count() })
      .from(targets)
      .innerJoin(subgraphs, eq(targets.id, subgraphs.targetId))
      .where(
        and(
          eq(targets.namespaceId, opts.namespaceId),
          eq(targets.organizationId, this.organizationId),
          eq(subgraphs.type, 'grpc_plugin'),
        ),
      );

    return pluginCount[0].count;
  }
}
