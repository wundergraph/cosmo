import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { BatchPublishJobStatus, NewBatchPublishJobDetails } from '../../db/models.js';
import { traced } from '../tracing.js';

const ONE_DAY_IN_SECONDS = 86_400;
const LOCK_ACQUISITION_TIMEOUT_IN_MILLISECONDS = 30 * 60_000;
const LOCK_TTL_IN_SECONDS = 30;
const LOCK_HEARTBEAT_INTERVAL = 5000;

class LockAcquisitionTimeoutError extends Error {}

@traced
export class BatchPublishJobDetailsRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private organizationId: string,
  ) {}

  public async create() {
    const [{ id }] = await this.db
      .insert(schema.batchPublishJobDetails)
      .values({
        status: 'pending',
        organizationId: this.organizationId,
      })
      .returning();

    return id;
  }

  public async byId(jobId: string) {
    if (!jobId) {
      return undefined;
    }

    const [jobDetails] = await this.db
      .select({
        status: schema.batchPublishJobDetails.status,
        failureReason: schema.batchPublishJobDetails.failureReason,
        compositionResult: schema.batchPublishJobDetails.compositionResult,
        createdAt: schema.batchPublishJobDetails.createdAt,
        updatedAt: schema.batchPublishJobDetails.updatedAt,
        lockExpiresAt: schema.batchPublishJobDetailsJobLocks.expiresAt,
      })
      .from(schema.batchPublishJobDetails)
      .where(
        and(
          eq(schema.batchPublishJobDetails.organizationId, this.organizationId),
          eq(schema.batchPublishJobDetails.id, jobId),
          sql`${schema.batchPublishJobDetails.createdAt}  >= now() - make_interval(secs => ${ONE_DAY_IN_SECONDS})`,
        ),
      )
      .leftJoin(
        schema.batchPublishJobDetailsJobLocks,
        eq(schema.batchPublishJobDetails.id, schema.batchPublishJobDetailsJobLocks.jobId),
      )
      .execute();

    return jobDetails;
  }

  public update(
    jobId: string,
    values: {
      status: BatchPublishJobStatus;
      failureReason?: string | null;
      compositionResult?: NewBatchPublishJobDetails['compositionResult'];
    },
  ) {
    return this.db
      .update(schema.batchPublishJobDetails)
      .set({ ...values, updatedAt: new Date() })
      .where(
        and(
          eq(schema.batchPublishJobDetails.organizationId, this.organizationId),
          eq(schema.batchPublishJobDetails.id, jobId),
        ),
      )
      .execute();
  }

  public delete(jobId: string) {
    return this.db
      .delete(schema.batchPublishJobDetails)
      .where(
        and(
          eq(schema.batchPublishJobDetails.organizationId, this.organizationId),
          eq(schema.batchPublishJobDetails.id, jobId),
        ),
      )
      .execute();
  }

  public async withNamespaceLock<Result>(namespaceId: string, jobId: string, fn: () => Result): Promise<Result> {
    const lock = await this.#acquireLock(namespaceId, jobId);
    const heartbeatInterval = setInterval(
      () =>
        this.db
          .update(schema.batchPublishJobDetailsJobLocks)
          .set({
            expiresAt: sql`now() + make_interval(secs => ${LOCK_TTL_IN_SECONDS})`,
          })
          .where(eq(schema.batchPublishJobDetailsJobLocks.id, lock))
          .catch(() => {}),
      LOCK_HEARTBEAT_INTERVAL,
    );

    heartbeatInterval.unref();

    try {
      return await fn();
    } finally {
      clearInterval(heartbeatInterval);
      await this.db
        .delete(schema.batchPublishJobDetailsJobLocks)
        .where(eq(schema.batchPublishJobDetailsJobLocks.id, lock))
        .catch(() => {});
    }
  }

  /**
   * The name is intentional as we don't want to produce many spans when a lock is active.
   *
   * @param namespaceId
   * @param jobId
   * @private
   */
  async #acquireLock(namespaceId: string, jobId: string) {
    const deadline = Date.now() + LOCK_ACQUISITION_TIMEOUT_IN_MILLISECONDS;
    const expiresAt = sql`now() + make_interval(secs => ${LOCK_TTL_IN_SECONDS})`;

    for (;;) {
      const [lock] = await this.db
        .insert(schema.batchPublishJobDetailsJobLocks)
        .values({
          organizationId: this.organizationId,
          namespaceId,
          jobId,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: schema.batchPublishJobDetailsJobLocks.namespaceId,
          set: { jobId, expiresAt },
          setWhere: sql`${schema.batchPublishJobDetailsJobLocks.expiresAt} < now()`,
        })
        .returning({ id: schema.batchPublishJobDetailsJobLocks.id });

      if (lock?.id) {
        return lock.id;
      }

      if (Date.now() > deadline) {
        throw new LockAcquisitionTimeoutError(
          `Could not acquire lock for namespace ${namespaceId} within the expected time`,
        );
      }

      // Retry after 1 second with a small random jitter
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
    }
  }
}
