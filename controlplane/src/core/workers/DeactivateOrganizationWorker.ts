import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import Keycloak from '../services/Keycloak.js';
import { DeleteOrganizationQueue } from './DeleteOrganizationWorker.js';
import { IQueue, IWorker } from './Worker.js';

const QueueName = 'organization.deactivate';
const WorkerName = 'DeactivateOrganizationWorker';

export interface DeactivateOrganizationInput {
  organizationId: string;
  organizationSlug: string;
  deactivationReason?: string;
}

export class DeactivateOrganizationQueue implements IQueue<DeactivateOrganizationInput> {
  private readonly queue: Queue<DeactivateOrganizationInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeactivateOrganizationInput>(QueueName, {
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

class DeactivateOrganizationWorker implements IWorker {
  constructor(
    private input: {
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
      deleteOrganizationQueue: DeleteOrganizationQueue;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<DeactivateOrganizationInput>) {
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

export const createDeactivateOrganizationWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  keycloakClient: Keycloak;
  keycloakRealm: string;
  deleteOrganizationQueue: DeleteOrganizationQueue;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<DeactivateOrganizationInput>(
    QueueName,
    (job) => new DeactivateOrganizationWorker(input).handler(job),
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
