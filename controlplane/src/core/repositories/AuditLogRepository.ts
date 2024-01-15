import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { desc, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { AuditableType, AuditActorType, AuditLogAction, AuditLogFullAction, AuditTargetType } from '../../db/models.js';

export type AddAuditLogInput = {
  organizationId: string;
  actorId: string;
  auditAction: AuditLogFullAction;
  action: AuditLogAction;
  actorDisplayName: string;
  actorType: AuditActorType;
  targetId?: string;
  targetType?: AuditTargetType;
  targetDisplayName?: string;
  auditableType?: AuditableType;
  auditableDisplayName: string;
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
        })),
      )
      .execute();
  }

  public getAuditLogs(input: { organizationId: string; limit: number; offset: number }) {
    return this.db
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
      })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, input.organizationId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(input.limit)
      .offset(input.offset)
      .execute();
  }
}
