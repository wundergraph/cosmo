import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { ConnectionOptions, Job, JobsOptions } from 'bullmq';
import pino from 'pino';
import { BlobStorage } from '../blobstorage/index.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import Keycloak from '../services/Keycloak.js';
import { PlatformWebhookService } from '../webhooks/PlatformWebhookService.js';
import { DB } from '../../db/index.js';
import { BaseQueue, BaseWorker } from './base/index.js';
import { DeleteOrganizationAuditLogsQueue } from './DeleteOrganizationAuditLogs.js';

const QueueName = 'user.delete';
const WorkerName = 'DeleteUserWorker';

export interface DeleteUserInput {
  userId: string;
  userEmail: string;
}

export class DeleteUserQueue extends BaseQueue<DeleteUserInput> {
  constructor(log: pino.Logger, conn: ConnectionOptions) {
    super({ name: QueueName, log, conn });
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

export class DeleteUserWorker extends BaseWorker<DeleteUserInput> {
  constructor(
    private input: {
      db: DB;
      redisConnection: ConnectionOptions;
      logger: pino.Logger;
      keycloakClient: Keycloak;
      keycloakRealm: string;
      blobStorage: BlobStorage;
      platformWebhooks: PlatformWebhookService;
      deleteOrganizationAuditLogsQueue: DeleteOrganizationAuditLogsQueue;
    },
  ) {
    super(WorkerName, QueueName, { connection: input.redisConnection, concurrency: 10 }, input.logger);
  }

  protected async handler(job: Job<DeleteUserInput>) {
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
