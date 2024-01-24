import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import * as schema from '../../db/schema.js';
import { PublicError } from '../errors/errors.js';

export const DefaultNamespace = 'default';

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

  public async create(data: { name: string; createdBy: string }) {
    const ns = await this.db
      .insert(schema.namespaces)
      .values({
        name: data.name,
        organizationId: this.organizationId,
        createdBy: data.createdBy,
      })
      .returning();

    if (ns.length === 0) {
      throw new PublicError(EnumStatusCode.ERR, 'Could not create namespace');
    }

    return ns[0];
  }

  public async delete(name: string) {
    await this.db
      .delete(schema.namespaces)
      .where(and(eq(schema.namespaces.name, name), eq(schema.namespaces.organizationId, this.organizationId)));
  }

  public async rename(data: { name: string; newName: string }) {
    await this.db
      .update(schema.namespaces)
      .set({
        name: data.newName,
      })
      .where(and(eq(schema.namespaces.name, data.name), eq(schema.namespaces.organizationId, this.organizationId)));
  }

  public list() {
    return this.db.query.namespaces.findMany({
      where: eq(schema.namespaces.organizationId, this.organizationId),
    });
  }
}
