import { and, eq, inArray, SQL } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { NamespaceDTO } from '../../types/index.js';
import { RBACEvaluator } from '../services/RBACEvaluator.js';

export const DefaultNamespace = 'default';

export class NamespaceRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async byName(name: string): Promise<NamespaceDTO | undefined> {
    const namespace = await this.db.query.namespaces.findFirst({
      where: and(eq(schema.namespaces.organizationId, this.organizationId), eq(schema.namespaces.name, name)),
      with: {
        namespaceConfig: true,
      },
    });

    if (!namespace) {
      return undefined;
    }

    return {
      id: namespace.id,
      name: namespace.name,
      enableGraphPruning: namespace.namespaceConfig?.enableGraphPruning ?? false,
      enableLinting: namespace.namespaceConfig?.enableLinting ?? false,
      organizationId: namespace.organizationId,
      createdBy: namespace.createdBy || undefined,
      enableCacheWarmer: namespace.namespaceConfig?.enableCacheWarming ?? false,
      checksTimeframeInDays: namespace.namespaceConfig?.checksTimeframeInDays || undefined,
      enableProposals: namespace.namespaceConfig?.enableProposals ?? false,
    };
  }

  public async byId(id: string): Promise<NamespaceDTO | undefined> {
    const namespace = await this.db.query.namespaces.findFirst({
      where: and(eq(schema.namespaces.organizationId, this.organizationId), eq(schema.namespaces.id, id)),
      with: {
        namespaceConfig: true,
      },
    });

    if (!namespace) {
      return undefined;
    }

    return {
      id: namespace.id,
      name: namespace.name,
      enableGraphPruning: namespace.namespaceConfig?.enableGraphPruning ?? false,
      enableLinting: namespace.namespaceConfig?.enableLinting ?? false,
      organizationId: namespace.organizationId,
      createdBy: namespace.createdBy || undefined,
      enableCacheWarmer: namespace.namespaceConfig?.enableCacheWarming ?? false,
      checksTimeframeInDays: namespace.namespaceConfig?.checksTimeframeInDays || undefined,
      enableProposals: namespace.namespaceConfig?.enableProposals ?? false,
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

  public create(data: { name: string; createdBy: string }) {
    return this.db.transaction(async (tx) => {
      const ns = await tx
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

      await tx.insert(schema.namespaceConfig).values({ namespaceId: ns[0].id });

      return ns[0];
    });
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

  private async applyRbacConditionsToQuery(
    rbac: RBACEvaluator | undefined,
    conditions: (SQL<unknown> | undefined)[],
  ): Promise<void> {
    if (!rbac || rbac.isOrganizationViewer) {
      return;
    }

    const namespaceAdmin = rbac.ruleFor('namespace-admin');
    const namespaceViewer = rbac.ruleFor('namespace-viewer');
    if (
      // The actor have admin access to every namespace
      (namespaceAdmin && namespaceAdmin.namespaces.length === 0) ||
      // The actor have readonly access to every namespace
      (namespaceViewer && namespaceViewer.namespaces.length === 0) ||
      // The actor have access to every resource
      (rbac.namespaces.length === 0 && rbac.resources.length === 0)
    ) {
      return;
    }

    const namespacesBasedOnResources: string[] = [];
    if (rbac.resources.length > 0) {
      const targets = await this.db
        .selectDistinct({ namespaceId: schema.targets.namespaceId })
        .from(schema.targets)
        .where(and(eq(schema.targets.organizationId, this.organizationId), inArray(schema.targets.id, rbac.resources)));

      namespacesBasedOnResources.push(...targets.map((ns) => ns.namespaceId));
    }

    const namespaces = [...new Set([...rbac.namespaces, ...namespacesBasedOnResources])];
    if (namespaces.length === 0) {
      conditions.push(eq(schema.namespaces.name, DefaultNamespace));
    } else {
      conditions.push(inArray(schema.namespaces.id, [...new Set([...rbac.namespaces, ...namespacesBasedOnResources])]));
    }
  }

  public async list(rbac?: RBACEvaluator) {
    const conditions: (SQL<unknown> | undefined)[] = [eq(schema.namespaces.organizationId, this.organizationId)];

    await this.applyRbacConditionsToQuery(rbac, conditions);
    return this.db.query.namespaces.findMany({ where: and(...conditions) });
  }

  public async updateConfiguration(data: {
    id: string;
    enableLinting?: boolean;
    enableGraphPruning?: boolean;
    enableCacheWarming?: boolean;
    checksTimeframeInDays?: number;
    enableProposals?: boolean;
  }) {
    const values = {
      namespaceId: data.id,
      enableLinting: data.enableLinting,
      enableGraphPruning: data.enableGraphPruning,
      enableCacheWarming: data.enableCacheWarming,
      checksTimeframeInDays: data.checksTimeframeInDays,
      enableProposals: data.enableProposals,
    };

    await this.db.insert(schema.namespaceConfig).values(values).onConflictDoUpdate({
      target: schema.namespaceConfig.namespaceId,
      set: values,
    });
  }
}
