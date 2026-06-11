import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { BatchPublishJobStatus, NewBatchPublishJobDetails } from '../../db/models.js';

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
}
