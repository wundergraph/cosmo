import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { BlobStorage } from '../blobstorage/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { S3RouterConfigMetadata } from '../composition/composer.js';
import { CacheWarmerRepository } from '../repositories/CacheWarmerRepository.js';
import { IQueue, IWorker } from './Worker.js';

const QueueName = 'cache.warmer';
const WorkerName = 'CacheWarmerWorker';

export interface CacheWarmerInput {
  organizationId: string;
  federatedGraphId: string;
  rangeInHours: number;
}

export class CacheWarmerQueue implements IQueue<CacheWarmerInput> {
  private readonly queue: Queue<CacheWarmerInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<CacheWarmerInput>(QueueName, {
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

  public addJob(job: CacheWarmerInput, opts?: Omit<JobsOptions, 'jobId'>) {
    this.logger.info('Adding cache warmer job');
    const jobId = `${job.organizationId}/${job.federatedGraphId}`;
    return this.queue.add(jobId, job, {
      ...opts,
      jobId,
    });
  }

  public removeJob(job: CacheWarmerInput) {
    const jobId = `${job.organizationId}/${job.federatedGraphId}`;
    return this.queue.remove(jobId);
  }

  public getJob(job: CacheWarmerInput) {
    const jobId = `${job.organizationId}/${job.federatedGraphId}`;
    return this.queue.getJob(jobId);
  }
}

class CacheWarmerWorker implements IWorker {
  constructor(
    private input: {
      db: PostgresJsDatabase<typeof schema>;
      chClient: ClickHouseClient | undefined;
      blobStorage: BlobStorage;
      logger: pino.Logger;
      cacheWarmerQueue: CacheWarmerQueue;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<CacheWarmerInput>) {
    const organizationId = job.data.organizationId;
    const federatedGraphId = job.data.federatedGraphId;
    const rangeInHours = job.data.rangeInHours;
    try {
      this.input.logger.info('Processing cache warmer job');

      if (!this.input.chClient) {
        this.input.logger.error('ClickHouse client is not available');
        throw new Error('ClickHouse client is not available');
      }

      const cacheWarmerRepo = new CacheWarmerRepository(this.input.chClient, this.input.db);
      const cacheWarmerOperations = await cacheWarmerRepo.computeCacheWarmerOperations({
        federatedGraphId,
        organizationId,
        rangeInHours,
      });

      const cacheWarmerOperationsBytes = Buffer.from(cacheWarmerOperations.toJsonString(), 'utf8');
      const path = `${organizationId}/${federatedGraphId}/cache_warmup/operations.json`;

      await this.input.blobStorage.putObject<S3RouterConfigMetadata>({
        key: path,
        body: cacheWarmerOperationsBytes,
        contentType: 'application/json; charset=utf-8',
      });
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, err },
        `Failed to compute and upload the cache warmer operations for ${federatedGraphId} to the blob storage`,
      );
      throw err;
    }
  }
}

export const createCacheWarmerWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  chClient: ClickHouseClient | undefined;
  blobStorage: BlobStorage;
  cacheWarmerQueue: CacheWarmerQueue;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<CacheWarmerInput>(QueueName, (job) => new CacheWarmerWorker(input).handler(job), {
    connection: input.redisConnection,
    concurrency: 10,
  });
  worker.on('stalled', (job) => {
    log.warn({ joinId: job }, `Job stalled`);
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });
  return worker;
};
