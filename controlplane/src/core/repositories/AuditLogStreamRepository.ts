import { and, asc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { auditLogs, auditLogStreamConfigs } from '../../db/schema.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Audit logs are only delivered once they are this old. created_at is set when the row is inserted, so a transaction
 * that commits late can make a row visible after newer rows were already delivered and the cursor passed it.
 */
const SETTLE_DELAY = '30 seconds';

export type AuditLogStreamConfig = typeof auditLogStreamConfigs.$inferSelect;
type AuditLogStreamConfigInput = Pick<
  typeof auditLogStreamConfigs.$inferInsert,
  'organizationId' | 'endpoint' | 'token' | 'index' | 'source' | 'sourcetype' | 'enabled'
>;

export class AuditLogStreamRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public get(organizationId: string) {
    return this.db.query.auditLogStreamConfigs.findFirst({
      where: eq(auditLogStreamConfigs.organizationId, organizationId),
    });
  }

  /**
   * Creates or replaces the organization's config. Leaving out the token keeps the stored one, and only updates an
   * existing config, so a config deleted in the meantime is never recreated without a token. Returns whether a config
   * was saved. Any previous error is cleared, so a fixed config doesn't show the old error.
   */
  public async upsert(input: Omit<AuditLogStreamConfigInput, 'token'> & { token?: string }) {
    const { organizationId, token, ...fields } = input;
    const set = { ...fields, lastError: null, lastErrorAt: null, updatedAt: new Date() };

    if (token === undefined) {
      const updated = await this.db
        .update(auditLogStreamConfigs)
        .set(set)
        .where(eq(auditLogStreamConfigs.organizationId, organizationId))
        .returning({ organizationId: auditLogStreamConfigs.organizationId })
        .execute();
      return updated.length > 0;
    }

    await this.db
      .insert(auditLogStreamConfigs)
      .values({ organizationId, token, ...fields })
      .onConflictDoUpdate({ target: auditLogStreamConfigs.organizationId, set: { ...set, token } })
      .execute();
    return true;
  }

  public async delete(organizationId: string) {
    const deleted = await this.db
      .delete(auditLogStreamConfigs)
      .where(eq(auditLogStreamConfigs.organizationId, organizationId))
      .returning()
      .execute();
    return deleted[0];
  }

  public listEnabled() {
    return this.db.query.auditLogStreamConfigs.findMany({
      where: eq(auditLogStreamConfigs.enabled, true),
    });
  }

  /**
   * Returns the next audit logs after the config's cursor, oldest first.
   */
  public getPendingLogs(organizationId: string, limit: number) {
    return this.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, organizationId),
          // The cursor is read in SQL for the same microsecond reason as in recordSuccess.
          sql`(${auditLogs.createdAt}, ${auditLogs.id}) > (
            select ${auditLogStreamConfigs.cursorCreatedAt}, coalesce(${auditLogStreamConfigs.cursorId}, ${NIL_UUID}::uuid)
            from ${auditLogStreamConfigs}
            where ${auditLogStreamConfigs.organizationId} = ${organizationId}
          )`,
          sql`${auditLogs.createdAt} < now() - ${SETTLE_DELAY}::interval`,
        ),
      )
      .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
      .limit(limit)
      .execute();
  }

  /**
   * Records a successful delivery and, when given, moves the cursor to the last delivered audit log. The cursor
   * timestamp is read in SQL rather than passed from JS, because JS dates drop the microseconds Postgres stores, and a
   * truncated cursor would re-deliver the same row forever.
   */
  public async recordSuccess(organizationId: string, lastDeliveredLogId?: string) {
    const cursor = lastDeliveredLogId
      ? {
          cursorId: lastDeliveredLogId,
          cursorCreatedAt: sql`(select ${auditLogs.createdAt} from ${auditLogs} where ${auditLogs.id} = ${lastDeliveredLogId})`,
        }
      : {};
    await this.db
      .update(auditLogStreamConfigs)
      .set({ ...cursor, lastSuccessAt: new Date(), lastError: null, lastErrorAt: null })
      .where(eq(auditLogStreamConfigs.organizationId, organizationId))
      .execute();
  }

  public async recordError(organizationId: string, error: string) {
    await this.db
      .update(auditLogStreamConfigs)
      .set({ lastError: error, lastErrorAt: new Date() })
      .where(eq(auditLogStreamConfigs.organizationId, organizationId))
      .execute();
  }
}
