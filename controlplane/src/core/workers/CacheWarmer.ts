import { ConnectionOptions, Job, JobsOptions } from 'bullmq';
import pino from 'pino';
import { BlobStorage } from '../blobstorage/index.js';
import { ClickHouseClient } from '../clickhouse/index.js';
import { S3RouterConfigMetadata } from '../composition/composer.js';
import { CacheWarmerRepository } from '../repositories/CacheWarmerRepository.js';
import { DB } from '../../db/index.js';
import { BaseQueue, BaseWorker } from './base/index.js';

const QueueName = 'cache.warmer';
const WorkerName = 'CacheWarmerWorker';

export interface CacheWarmerInput {
  organizationId: string;
  federatedGraphId: string;
  rangeInHours: number;
}

export class CacheWarmerQueue extends BaseQueue<CacheWarmerInput> {
  constructor(log: pino.Logger, conn: ConnectionOptions) {
    super({
      name: QueueName,
      conn,
      log,
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

export class CacheWarmerWorker extends BaseWorker<CacheWarmerInput> {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: DB;
      logger: pino.Logger;
      chClient: ClickHouseClient | undefined;
      blobStorage: BlobStorage;
      cacheWarmerQueue: CacheWarmerQueue;
    },
  ) {
    super(WorkerName, QueueName, { connection: input.redisConnection, concurrency: 10 }, input.logger);
  }

  protected async handler(job: Job<CacheWarmerInput>) {
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
        // TODO have to fetch the number of operations from the cache configuration of the namespace
        maxOperationsCount: 100,
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
