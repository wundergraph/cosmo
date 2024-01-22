import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';

export class NamespaceRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public byName(name: string) {
    return this.db.query.namespaces.findFirst({
      where: and(eq(schema.namespaces.organizationId, this.organizationId), eq(schema.namespaces.name, name)),
    });
  }

  public async byTargetId(id: string) {
    const res = await this.db.query.namespaces.findMany({
      where: and(eq(schema.namespaces.organizationId, this.organizationId)),
      with: {
        targets: {
          columns: {
            id: true,
          },
        },
      },
    });

    return res.find((r) => r.targets.find((t) => t.id === id));
  }
}
