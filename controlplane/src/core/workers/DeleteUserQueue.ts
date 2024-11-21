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

const QueueName = 'user.delete';
const WorkerName = 'DeleteUserWorker';

export interface DeleteUserInput {
  userId: string;
}

export class DeleteUserQueue {
  private readonly queue: Queue<DeleteUserInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeleteUserInput>(QueueName, {
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

class DeleteUserWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
      blobStorage: BlobStorage;
      platformWebhooks: PlatformWebhookService;
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
      if (!user || !user.id || !user.email) {
        throw new Error('User not found');
      }

      const { isSafe, soloOrganizations, unsafeOrganizations } = await orgRepo.canUserBeDeleted(job.data.userId);

      if (!isSafe) {
        this.input.logger.error(
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
      );

      this.input.platformWebhooks.send(PlatformEventName.USER_DELETE_SUCCESS, {
        user_id: user.id,
        user_email: user.email!,
      });
    } catch (err) {
      this.input.logger.error(err, `Failed to delete user with id ${job.data.userId}`);
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
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<DeleteUserInput>(QueueName, (job) => new DeleteUserWorker(input).handler(job), {
    connection: input.redisConnection,
    concurrency: 10,
  });
  worker.on('stalled', (job) => {
    log.warn(`Job ${job} stalled`);
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });
  return worker;
};
