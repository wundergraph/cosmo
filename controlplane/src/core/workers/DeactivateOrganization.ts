import { ConnectionOptions, Job, JobsOptions } from 'bullmq';
import pino from 'pino';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import Keycloak from '../services/Keycloak.js';
import { DB } from '../../db/index.js';
import { DeleteOrganizationQueue } from './DeleteOrganization.js';
import { BaseQueue, BaseWorker } from './base/index.js';

const QueueName = 'organization.deactivate';
const WorkerName = 'DeactivateOrganizationWorker';

export interface DeactivateOrganizationInput {
  organizationId: string;
  organizationSlug: string;
  deactivationReason?: string;
}

export class DeactivateOrganizationQueue extends BaseQueue<DeactivateOrganizationInput> {
  constructor(log: pino.Logger, conn: ConnectionOptions) {
    super({ name: QueueName, conn, log });
  }

  public addJob(job: DeactivateOrganizationInput, opts?: Omit<JobsOptions, 'jobId'>) {
    this.logger.info('Adding deactivate job');
    return this.queue.add(job.organizationId, job, {
      ...opts,
      jobId: job.organizationId,
    });
  }

  public removeJob(job: DeactivateOrganizationInput) {
    return this.queue.remove(job.organizationId);
  }

  public getJob(job: DeactivateOrganizationInput) {
    return this.queue.getJob(job.organizationId);
  }
}

export class DeactivateOrganizationWorker extends BaseWorker<DeactivateOrganizationInput> {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: DB;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
      deleteOrganizationQueue: DeleteOrganizationQueue;
    },
  ) {
    super(WorkerName, QueueName, { connection: input.redisConnection, concurrency: 10 }, input.logger);
  }

  protected async handler(job: Job<DeactivateOrganizationInput>) {
    try {
      this.input.logger.info('Processing deactivate job');
      const orgRepo = new OrganizationRepository(this.input.logger, this.input.db);

      await this.input.keycloakClient.authenticateClient();

      const org = await orgRepo.bySlug(job.data.organizationSlug);
      if (!org) {
        throw new Error('Organization not found');
      }

      if (org.id !== job.data.organizationId) {
        throw new Error('Id and slug mismatch');
      }

      await orgRepo.deactivateOrganization({
        organizationId: job.data.organizationId,
        reason: job.data.deactivationReason,
        keycloakClient: this.input.keycloakClient,
        keycloakRealm: this.input.keycloakRealm,
        deleteOrganizationQueue: this.input.deleteOrganizationQueue,
      });
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, err },
        `Failed to deactivate organization`,
      );
      throw err;
    }
  }
}
