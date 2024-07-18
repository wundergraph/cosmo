import { ConnectionOptions, Job, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import Keycloak from '../services/Keycloak.js';

const QueueName = 'organization.delete';
const WorkerName = 'DeleteOrganizationWorker';

export interface DeleteOrganizationInput {
  organizationId: string;
}

export class DeleteOrganizationQueue {
  private readonly queue: Queue<DeleteOrganizationInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeleteOrganizationInput>(QueueName, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10_000,
        },
      },
    });

    this.queue.on('error', (err) => {
      this.logger.error(err, 'Queue error');
    });
  }

  public async addJob(job: DeleteOrganizationInput) {
    await this.queue.add(`organizations/${job.organizationId}`, job);
  }
}

class DeleteOrganizationWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<DeleteOrganizationInput>) {
    try {
      const orgRepo = new OrganizationRepository(this.input.logger, this.input.db);

      await this.input.keycloakClient.authenticateClient();

      const org = await orgRepo.byId(job.data.organizationId);
      if (!org) {
        throw new Error('Organization not found');
      }

      await orgRepo.deleteOrganization(job.data.organizationId);

      await this.input.keycloakClient.deleteOrganizationGroup({
        realm: this.input.keycloakRealm,
        organizationSlug: org.slug,
      });
    } catch (err) {
      this.input.logger.error(err, `Failed to delete organization with id ${job.data.organizationId}`);
      throw err;
    }
  }
}

export const createDeleteOrganizationWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  keycloakClient: Keycloak;
  keycloakRealm: string;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<DeleteOrganizationInput>(
    QueueName,
    (job) => new DeleteOrganizationWorker(input).handler(job),
    {
      connection: input.redisConnection,
      concurrency: 10,
    },
  );
  worker.on('stalled', (job) => {
    log.warn(`Job ${job} stalled`);
  });
  worker.on('error', (err) => {
    input.logger.error(err, 'Worker error');
  });
  return worker;
};
