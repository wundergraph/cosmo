import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, sql } from 'drizzle-orm';
import { BaseAdapter, createLock } from 'redlock-universal';
import * as schema from '../../db/schema.js';
import { BatchPublishJobStatus, NewBatchPublishJobDetails } from '../../db/models.js';
import { traced } from '../tracing.js';
import { retryWithBackoff } from '../util/timers.js';

const ONE_DAY_IN_SECONDS = 86_400;
const LOCK_ACQUISITION_TIMEOUT_IN_MILLISECONDS = 30 * 60_000;

@traced
export class BatchPublishJobDetailsRepository {
  constructor(
    private db: PostgresJsDatabase<typeof schema>,
    private lockAdapter: BaseAdapter,
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
      })
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

  public withNamespaceLock<Result>(namespaceId: string, fn: () => Promise<Result>): Promise<Result> {
    const lockHandle = createLock({
      adapter: this.lockAdapter,
      key: `batch-publish:${namespaceId}`,
      ttl: 15_000, // The lock should be released after 15 seconds, `using` keeps the lock alive if we are not done
      retryAttempts: 0, // We are going to retry with `retryWithBackoff` so the lock should not be retried
    });

    const lockAcquisitionDeadline = Date.now() + LOCK_ACQUISITION_TIMEOUT_IN_MILLISECONDS;
    return retryWithBackoff(() => lockHandle.using(fn), {
      attempts: 500, // We are waiting about ~40 minutes
      baseInterval: 1000,
      maxInterval: 5000,
      jitter: true,
      shouldRetry() {
        return Date.now() < lockAcquisitionDeadline;
      },
    });
  }
}
