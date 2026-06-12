import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { BatchPublishJobStatus, NewBatchPublishJobDetails } from '../../db/models.js';
import { traced } from '../tracing.js';

const ONE_DAY_IN_SECONDS = 86_400;
const OWNED_BATCH_PUBLISH_LOCK_IDS = new Set<string>();

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
      .select()
      .from(schema.batchPublishJobDetails)
      .where(
        and(
          eq(schema.batchPublishJobDetails.organizationId, this.organizationId),
          eq(schema.batchPublishJobDetails.id, jobId),
          sql`${schema.batchPublishJobDetails.createdAt}  >= now() - make_interval(secs => ${ONE_DAY_IN_SECONDS})`,
        ),
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
    OWNED_BATCH_PUBLISH_LOCK_IDS.add(lock);

    try {
      return await fn();
    } finally {
      OWNED_BATCH_PUBLISH_LOCK_IDS.delete(jobId);
      await this.db
        .delete(schema.batchPublishJobDetailsJobLocks)
        .where(eq(schema.batchPublishJobDetailsJobLocks.id, lock))
        .catch(() => {});
    }
  }

  public static async cleanupOwnedLocks(db: PostgresJsDatabase<typeof schema>) {
    if (OWNED_BATCH_PUBLISH_LOCK_IDS.size === 0) {
      return;
    }

    const pendingIds = [...OWNED_BATCH_PUBLISH_LOCK_IDS];
    while (pendingIds.length > 0) {
      const deleteChunk = pendingIds.splice(0, 100);
      const deletedLocks = await db
        .delete(schema.batchPublishJobDetailsJobLocks)
        .where(inArray(schema.batchPublishJobDetailsJobLocks.id, deleteChunk))
        .returning({ jobId: schema.batchPublishJobDetailsJobLocks.jobId })
        .catch(() => []);

      await db
        .update(schema.batchPublishJobDetails)
        .set({
          status: 'failed',
          failureReason: 'Server was shutdown before the composition completed.',
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(
              schema.batchPublishJobDetails.id,
              deletedLocks.map((l) => l.jobId),
            ),
            or(
              eq(schema.batchPublishJobDetails.status, 'pending'),
              eq(schema.batchPublishJobDetails.status, 'processing'),
            ),
          ),
        );

      if (deleteChunk.length < 100) {
        break;
      }
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
    const deadline = Date.now() + 30 * 60_000; // If we can't acquire the lock in 30 minutes, we bail
    const expiresAt = sql`now() + make_interval(secs => ${ONE_DAY_IN_SECONDS})`;

    for (;;) {
      const [lock] = await this.db
        .insert(schema.batchPublishJobDetailsJobLocks)
        .values({
          organizationId: this.organizationId,
          expiresAt,
          namespaceId,
          jobId,
        })
        .onConflictDoUpdate({
          target: schema.batchPublishJobDetailsJobLocks.namespaceId,
          set: { jobId, expiresAt },
          // If the lock has expired, we consider it to be abandoned as the job should have been cleaned already
          setWhere: sql`${schema.batchPublishJobDetailsJobLocks.expiresAt} < now()`,
        })
        .returning({ id: schema.batchPublishJobDetailsJobLocks.id });

      if (lock?.id) {
        return lock.id;
      }

      if (Date.now() > deadline) {
        throw new LockAcquisitionTimeoutError(`Could not acquire lock for namespace ${namespaceId} within 30 minutes`);
      }

      // Retry after 1 second with a small random jitter
      await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
    }
  }
}
