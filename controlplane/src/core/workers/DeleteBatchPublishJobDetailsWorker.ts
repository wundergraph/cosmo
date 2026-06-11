import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { BatchPublishJobDetailsRepository } from '../repositories/BatchPublishJobDetailsRepository.js';
import { IQueue, IWorker } from './Worker.js';

const QueueName = 'batch_publish.delete_job_details';
const WorkerName = 'DeleteBatchPublishJobDetailsWorker';

export interface DeleteBatchPublishJobDetailsInput {
  organizationId: string;
  jobId: string;
}

export class DeleteBatchPublishJobDetailsQueue implements IQueue<DeleteBatchPublishJobDetailsInput> {
  private readonly queue: Queue<DeleteBatchPublishJobDetailsInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeleteBatchPublishJobDetailsInput>(QueueName, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: {
          age: 90 * 86_400,
        },
        removeOnFail: {
          age: 90 * 86_400,
        },
        attempts: 6,
        backoff: {
          type: 'exponential',
          delay: 112_000,
        },
      },
    });

    this.queue.on('error', (err) => {
      this.logger.error(err, 'Queue error');
    });
  }

  public addJob(job: DeleteBatchPublishJobDetailsInput, opts?: Omit<JobsOptions, 'jobId'>) {
    const jobId = `${job.organizationId}/${job.jobId}`;
    return this.queue.add(jobId, job, {
      ...opts,
      delay: 86_400_000, // 24 hours in milliseconds
      jobId,
    });
  }

  public removeJob(job: DeleteBatchPublishJobDetailsInput) {
    return this.queue.remove(`${job.organizationId}/${job.jobId}`);
  }

  public getJob(job: DeleteBatchPublishJobDetailsInput) {
    return this.queue.getJob(`${job.organizationId}/${job.jobId}`);
  }
}

class DeleteBatchPublishJobDetailsWorker implements IWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<DeleteBatchPublishJobDetailsInput>) {
    try {
      const batchPublishJobDetailsRepo = new BatchPublishJobDetailsRepository(this.input.db, job.data.organizationId);
      await batchPublishJobDetailsRepo.delete(job.data.jobId);
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, batchPublishJobDetailsId: job.data.jobId, err },
        'Failed to delete batch publish job details',
      );
    }
  }
}

export const createDeleteBatchPublishJobDetailsWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<DeleteBatchPublishJobDetailsInput>(
    QueueName,
    (job) => new DeleteBatchPublishJobDetailsWorker(input).handler(job),
    {
      connection: input.redisConnection,
      concurrency: 10,
    },
  );

  worker.on('stalled', (job) => {
    log.warn({ joinId: job }, 'Job stalled');
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });

  return worker;
};
