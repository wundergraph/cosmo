import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import Keycloak from '../services/Keycloak.js';
import { OidcRepository } from '../repositories/OidcRepository.js';
import OidcProvider from '../services/OidcProvider.js';
import { BlobStorage } from '../blobstorage/index.js';
import { IQueue, IWorker } from './Worker.js';
import { DeleteOrganizationAuditLogsQueue } from './DeleteOrganizationAuditLogsWorker.js';

const QueueName = 'organization.delete';
const WorkerName = 'DeleteOrganizationWorker';

export interface DeleteOrganizationInput {
  organizationId: string;
}

export class DeleteOrganizationQueue implements IQueue<DeleteOrganizationInput> {
  private readonly queue: Queue<DeleteOrganizationInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeleteOrganizationInput>(QueueName, {
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

  public addJob(job: DeleteOrganizationInput, opts?: Omit<JobsOptions, 'jobId'>) {
    return this.queue.add(job.organizationId, job, {
      ...opts,
      jobId: job.organizationId,
    });
  }

  public removeJob(job: DeleteOrganizationInput) {
    return this.queue.remove(job.organizationId);
  }

  public getJob(job: DeleteOrganizationInput) {
    return this.queue.getJob(job.organizationId);
  }
}

class DeleteOrganizationWorker implements IWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
      blobStorage: BlobStorage;
      deleteOrganizationAuditLogsQueue: DeleteOrganizationAuditLogsQueue;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<DeleteOrganizationInput>) {
    try {
      const orgRepo = new OrganizationRepository(this.input.logger, this.input.db);
      const oidcRepo = new OidcRepository(this.input.db);
      const oidcProvider = new OidcProvider();

      const org = await orgRepo.byId(job.data.organizationId);
      if (!org) {
        throw new Error('Organization not found');
      }

      await this.input.keycloakClient.authenticateClient();

      const provider = await oidcRepo.getOidcProvider({ organizationId: job.data.organizationId });
      if (provider) {
        await oidcProvider.deleteOidcProvider({
          kcClient: this.input.keycloakClient,
          kcRealm: this.input.keycloakRealm,
          organizationSlug: org.slug,
          alias: provider.alias,
        });
      }

      await orgRepo.deleteOrganization(
        job.data.organizationId,
        this.input.blobStorage,
        this.input.deleteOrganizationAuditLogsQueue,
      );

      if (org.kcGroupId) {
        await this.input.keycloakClient.deleteGroupById({ realm: this.input.keycloakRealm, groupId: org.kcGroupId });
      }

      // Delete organization roles
      const kcOrgRoles = await this.input.keycloakClient.client.roles.find({
        realm: this.input.keycloakRealm,
        max: -1,
        search: `${org.slug}:`,
      });

      for (const kcRole of kcOrgRoles) {
        await this.input.keycloakClient.client.roles.delById({
          realm: this.input.keycloakRealm,
          id: kcRole.id!,
        });
      }
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, err },
        `Failed to delete organization`,
      );
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
  blobStorage: BlobStorage;
  deleteOrganizationAuditLogsQueue: DeleteOrganizationAuditLogsQueue;
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
    log.warn({ joinId: job }, `Job stalled`);
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });
  return worker;
};
