import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { BlobStorage } from '../blobstorage/index.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import Keycloak from '../services/Keycloak.js';
import { PlatformWebhookService } from '../webhooks/PlatformWebhookService.js';
import { IQueue, IWorker } from './Worker.js';
import { DeleteOrganizationAuditLogsQueue } from './DeleteOrganizationAuditLogsWorker.js';

const QueueName = 'user.delete';
const WorkerName = 'DeleteUserWorker';

export interface DeleteUserInput {
  userId: string;
  userEmail: string;
}

export class DeleteUserQueue implements IQueue<DeleteUserInput> {
  private readonly queue: Queue<DeleteUserInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeleteUserInput>(QueueName, {
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

  public addJob(job: DeleteUserInput, opts?: Omit<JobsOptions, 'jobId'>) {
    return this.queue.add(job.userId, job, {
      ...opts,
      jobId: job.userId,
    });
  }

  public removeJob(job: DeleteUserInput) {
    return this.queue.remove(job.userId);
  }

  public getJob(job: DeleteUserInput) {
    return this.queue.getJob(job.userId);
  }
}

class DeleteUserWorker implements IWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
      blobStorage: BlobStorage;
      platformWebhooks: PlatformWebhookService;
      deleteOrganizationAuditLogsQueue: DeleteOrganizationAuditLogsQueue;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<DeleteUserInput>) {
    try {
      const userRepo = new UserRepository(this.input.logger, this.input.db);
      const orgRepo = new OrganizationRepository(this.input.logger, this.input.db);

      await this.input.keycloakClient.authenticateClient();

      const user = await userRepo.byId(job.data.userId);
      if (user) {
        const { isSafe, soloOrganizations, unsafeOrganizations } = await orgRepo.canUserBeDeleted(job.data.userId);

        if (!isSafe) {
          this.input.logger.info(
            {
              userId: job.data.userId,
              soloOrganizations,
              unsafeOrganizations,
            },
            'Unsafe to delete user',
          );
          return;
        }

        await userRepo.deleteUser(
          {
            id: job.data.userId,
            keycloakClient: this.input.keycloakClient,
            keycloakRealm: this.input.keycloakRealm,
          },
          this.input.blobStorage,
          this.input.deleteOrganizationAuditLogsQueue,
        );
      }

      await this.input.platformWebhooks.send(PlatformEventName.USER_DELETE_SUCCESS, {
        user_id: job.data.userId,
        user_email: job.data.userEmail,
      });
    } catch (err) {
      this.input.logger.error({ jobId: job.id, userId: job.data.userId, err }, `Failed to delete user`);
      throw err;
    }
  }
}

export const createDeleteUserWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  keycloakClient: Keycloak;
  keycloakRealm: string;
  blobStorage: BlobStorage;
  platformWebhooks: PlatformWebhookService;
  deleteOrganizationAuditLogsQueue: DeleteOrganizationAuditLogsQueue;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<DeleteUserInput>(QueueName, (job) => new DeleteUserWorker(input).handler(job), {
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
