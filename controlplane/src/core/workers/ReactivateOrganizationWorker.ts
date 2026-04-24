import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import Keycloak from '../services/Keycloak.js';
import { DeleteOrganizationQueue } from './DeleteOrganizationWorker.js';
import { IQueue, IWorker } from './Worker.js';

const QueueName = 'organization.reactivate';
const WorkerName = 'ReactivateOrganizationWorker';

export interface ReactivateOrganizationInput {
  organizationId: string;
  organizationSlug: string;
}

export class ReactivateOrganizationQueue implements IQueue<ReactivateOrganizationInput> {
  private readonly queue: Queue<ReactivateOrganizationInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<ReactivateOrganizationInput>(QueueName, {
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

  public addJob(job: ReactivateOrganizationInput, opts?: Omit<JobsOptions, 'jobId'>) {
    return this.queue.add(job.organizationId, job, {
      ...opts,
      jobId: job.organizationId,
    });
  }

  public removeJob(job: ReactivateOrganizationInput) {
    return this.queue.remove(job.organizationId);
  }

  public getJob(job: ReactivateOrganizationInput) {
    return this.queue.getJob(job.organizationId);
  }
}

class ReactivateOrganizationWorker implements IWorker {
  constructor(
    private input: {
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      deleteOrganizationQueue: DeleteOrganizationQueue;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<ReactivateOrganizationInput>) {
    try {
      const orgRepo = new OrganizationRepository(this.input.logger, this.input.db);

      const org = await orgRepo.bySlug(job.data.organizationSlug);
      if (!org) {
        throw new Error('Organization not found');
      }

      if (org.id !== job.data.organizationId) {
        throw new Error('Id and slug mismatch');
      }

      await orgRepo.reactivateOrganization({
        organizationId: job.data.organizationId,
        deleteOrganizationQueue: this.input.deleteOrganizationQueue,
      });
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, err },
        `Failed to reactivate organization`,
      );
      throw err;
    }
  }
}

export const createReactivateOrganizationWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  deleteOrganizationQueue: DeleteOrganizationQueue;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<ReactivateOrganizationInput>(
    QueueName,
    (job) => new ReactivateOrganizationWorker(input).handler(job),
    {
      connection: input.redisConnection,
      concurrency: 10,
    },
  );
  worker.on('stalled', (job) => {
    log.warn({ jobId: job }, `Job stalled`);
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });
  return worker;
};
