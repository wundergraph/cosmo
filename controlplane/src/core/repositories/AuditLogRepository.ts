import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { desc, eq, gt, lt, and, sql, count } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { AuditableType, AuditActorType, AuditLogAction, AuditLogFullAction, AuditTargetType } from '../../db/models.js';

export type AddAuditLogInput = {
  organizationId: string;
  organizationSlug: string;
  // Empty string means the actor is the system.
  actorId?: string;
  auditAction: AuditLogFullAction;
  action: AuditLogAction;
  actorDisplayName: 'cosmo-bot' | string;
  actorType: AuditActorType;
  apiKeyName?: string;
  targetId?: string;
  targetType?: AuditTargetType;
  targetDisplayName?: string;
  auditableType?: AuditableType;
  auditableDisplayName: string;
  targetNamespaceId?: string;
  targetNamespaceDisplayName?: string;
};

/**
 * Repository for audit log related operations.
 */
export class AuditLogRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  /**
   * Add a new audit log entry.
   * Schema: {Actor} do {Action} on {Target *Optional*} + {With Auditable information}
   */
  public addAuditLog(...inputs: AddAuditLogInput[]) {
    return this.db
      .insert(schema.auditLogs)
      .values(
        inputs.map((input) => ({
          organizationId: input.organizationId,
          organizationSlug: input.organizationSlug,
          actorId: input.actorId,
          targetId: input.targetId,
          targetType: input.targetType,
          targetDisplayName: input.targetDisplayName,
          action: input.action,
          auditableType: input.auditableType,
          auditableDisplayName: input.auditableDisplayName,
          auditAction: input.auditAction,
          actorDisplayName: input.actorDisplayName,
          actorType: input.actorType,
          apiKeyName: input.apiKeyName,
          targetNamespaceId: input.targetNamespaceId,
          targetNamespaceDisplayName: input.targetNamespaceDisplayName,
        })),
      )
      .execute();
  }

  public getAuditLogs(input: {
    organizationId: string;
    limit: number;
    offset: number;
    startDate: string;
    endDate: string;
  }) {
    const query = this.db
      .select({
        id: schema.auditLogs.id,
        organizationId: schema.auditLogs.organizationId,
        actorId: schema.auditLogs.actorId,
        targetId: schema.auditLogs.targetId,
        targetDisplayName: schema.auditLogs.targetDisplayName,
        targetType: schema.auditLogs.targetType,
        action: schema.auditLogs.action,

        auditAction: schema.auditLogs.auditAction,
        auditableType: schema.auditLogs.auditableType,
        auditableDisplayName: schema.auditLogs.auditableDisplayName,

        actorDisplayName: schema.auditLogs.actorDisplayName,
        actorType: schema.auditLogs.actorType,
        createdAt: schema.auditLogs.createdAt,

        apiKeyName: schema.auditLogs.apiKeyName,

        targetNamespaceDisplayName: schema.auditLogs.targetNamespaceDisplayName,
        targetNamespaceId: schema.auditLogs.targetNamespaceId,
      })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, input.organizationId),
          gt(schema.auditLogs.createdAt, new Date(input.startDate)),
          lt(schema.auditLogs.createdAt, new Date(input.endDate)),
        ),
      )
      .orderBy(desc(schema.auditLogs.createdAt));

    if (input.limit) {
      query.limit(input.limit);
    }

    if (input.offset) {
      query.offset(input.offset);
    }

    return query.execute();
  }

  public async getAuditLogsCount(input: {
    organizationId: string;
    startDate: string;
    endDate: string;
  }): Promise<number> {
    const auditLogsCount = await this.db
      .select({ count: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.organizationId, input.organizationId),
          gt(schema.auditLogs.createdAt, new Date(input.startDate)),
          lt(schema.auditLogs.createdAt, new Date(input.endDate)),
        ),
      )
      .execute();

    if (auditLogsCount.length === 0) {
      return 0;
    }
    return auditLogsCount[0].count;
  }

  public deleteOrganizationLogs(input: { organizationId: string }) {
    return this.db.delete(schema.auditLogs).where(eq(schema.auditLogs.organizationId, input.organizationId)).execute();
  }
}
