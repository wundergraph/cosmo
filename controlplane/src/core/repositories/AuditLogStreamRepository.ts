import { and, asc, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { auditLogs, auditLogStreamConfigs } from '../../db/schema.js';

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Audit logs are only delivered once they are this old. A cheap guard for short transactions; getSettleCutoff covers
 * the long ones.
 */
export const SETTLE_DELAY = '30 seconds';

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
   * Returns the time before which no more audit logs can appear, as text to keep Postgres' microseconds.
   *
   * created_at defaults to now(), the start of the inserting transaction, but the row only becomes visible when that
   * transaction commits. A transaction still open now can only commit rows created at or after its own start, so
   * nothing older than the oldest open transaction can still appear. Delivering past that point could move the cursor
   * beyond a row that is about to commit.
   *
   * This must be read in its own statement before getPendingLogs. Within one statement, the rows are read from a
   * snapshot taken first and pg_stat_activity later, so a transaction committing in between would be in neither.
   *
   * pg_stat_activity only shows xact_start for sessions of the same role unless the role has pg_read_all_stats, so
   * every writer of audit logs must connect as the controlplane role. Prepared transactions don't appear in it; the
   * controlplane doesn't use them. A long unrelated transaction delays delivery but never loses rows.
   */
  public async getSettleCutoff(settleDelay = SETTLE_DELAY): Promise<string> {
    const result = await this.db.execute<{ cutoff: string }>(sql`
      select least(
        now() - ${settleDelay}::interval,
        (
          select min(xact_start) from pg_stat_activity
          where datname = current_database() and backend_type = 'client backend' and pid <> pg_backend_pid()
        )
      )::text as cutoff
    `);
    return result[0].cutoff;
  }

  /**
   * Returns the next audit logs after the config's cursor and before the cutoff from getSettleCutoff, oldest first.
   */
  public getPendingLogs(organizationId: string, limit: number, cutoff: string) {
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
          sql`${auditLogs.createdAt} < ${cutoff}::timestamptz`,
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
