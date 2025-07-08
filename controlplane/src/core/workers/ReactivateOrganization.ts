import { ConnectionOptions, Job, JobsOptions } from 'bullmq';
import pino from 'pino';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { DB } from '../../db/index.js';
import { DeleteOrganizationQueue } from './DeleteOrganization.js';
import { BaseQueue, BaseWorker } from './base/index.js';

const QueueName = 'organization.reactivate';
const WorkerName = 'ReactivateOrganizationWorker';

export interface ReactivateOrganizationInput {
  organizationId: string;
  organizationSlug: string;
}

export class ReactivateOrganizationQueue extends BaseQueue<ReactivateOrganizationInput> {
  constructor(log: pino.Logger, conn: ConnectionOptions) {
    super({ name: QueueName, log, conn });
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

export class ReactivateOrganizationWorker extends BaseWorker<ReactivateOrganizationInput> {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: DB;
      logger: pino.Logger;
      deleteOrganizationQueue: DeleteOrganizationQueue;
    },
  ) {
    super(WorkerName, QueueName, { connection: input.redisConnection, concurrency: 10 }, input.logger);
  }

  protected async handler(job: Job<ReactivateOrganizationInput>) {
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
