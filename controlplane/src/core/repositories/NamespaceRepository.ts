import { Name, and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { NamespaceDTO } from '../../types/index.js';

export const DefaultNamespace = 'default';

export class NamespaceRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async byName(name: string): Promise<NamespaceDTO | undefined> {
    const namespace = await this.db.query.namespaces.findFirst({
      where: and(eq(schema.namespaces.organizationId, this.organizationId), eq(schema.namespaces.name, name)),
    });

    if (!namespace) {
      return undefined;
    }

    return {
      id: namespace.id,
      name: namespace.name,
      enableGraphPruning: namespace.enableGraphPruning,
      enableLinting: namespace.enableLinting,
      organizationId: namespace.organizationId,
      createdBy: namespace.createdBy || undefined,
      enableCacheWarmer: namespace.enableCacheWarming,
    };
  }

  public async byId(id: string): Promise<NamespaceDTO | undefined> {
    const namespace = await this.db.query.namespaces.findFirst({
      where: and(eq(schema.namespaces.organizationId, this.organizationId), eq(schema.namespaces.id, id)),
    });

    if (!namespace) {
      return undefined;
    }

    return {
      id: namespace.id,
      name: namespace.name,
      enableGraphPruning: namespace.enableGraphPruning,
      enableLinting: namespace.enableLinting,
      organizationId: namespace.organizationId,
      createdBy: namespace.createdBy || undefined,
      enableCacheWarmer: namespace.enableCacheWarming,
    };
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
      return;
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

  public async toggleEnableLinting(data: { name: string; enableLinting: boolean }) {
    await this.db
      .update(schema.namespaces)
      .set({
        enableLinting: data.enableLinting,
      })
      .where(and(eq(schema.namespaces.name, data.name), eq(schema.namespaces.organizationId, this.organizationId)));
  }

  public async toggleEnableGraphPruning(data: { id: string; enableGraphPruning: boolean }) {
    await this.db
      .update(schema.namespaces)
      .set({
        enableGraphPruning: data.enableGraphPruning,
      })
      .where(and(eq(schema.namespaces.id, data.id), eq(schema.namespaces.organizationId, this.organizationId)));
  }

  public async toggleEnableCacheWarmer(data: { id: string; enableCacheWarming: boolean }) {
    await this.db
      .update(schema.namespaces)
      .set({
        enableCacheWarming: data.enableCacheWarming,
      })
      .where(and(eq(schema.namespaces.id, data.id), eq(schema.namespaces.organizationId, this.organizationId)));
  }
}
