import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import Mailer from '../services/Mailer.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import { IQueue, IWorker } from './Worker.js';

const QueueName = 'organization.send-deletion-queued-message';
const WorkerName = 'SendOrganizationDeletionQueuedWorker';

export interface NotifyOrganizationDeletionQueuedInput {
  organizationId: string;
  queuedAt: number;
  deletesAt: number;
}

export class NotifyOrganizationDeletionQueuedQueue implements IQueue<NotifyOrganizationDeletionQueuedInput> {
  private readonly queue: Queue<NotifyOrganizationDeletionQueuedInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<NotifyOrganizationDeletionQueuedInput>(QueueName, {
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

  public addJob(job: NotifyOrganizationDeletionQueuedInput, opts?: Omit<JobsOptions, 'jobId'>) {
    return this.queue.add(job.organizationId, job, {
      ...opts,
      jobId: job.organizationId,
    });
  }

  public removeJob(job: NotifyOrganizationDeletionQueuedInput) {
    return this.queue.remove(job.organizationId);
  }

  public getJob(job: NotifyOrganizationDeletionQueuedInput) {
    return this.queue.getJob(job.organizationId);
  }
}

class NotifyOrganizationDeletionQueuedWorker implements IWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
      mailer: Mailer | undefined;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<NotifyOrganizationDeletionQueuedInput>) {
    try {
      if (!this.input.mailer) {
        throw new Error('Mailer service not configured');
      }

      const orgRepo = new OrganizationRepository(this.input.logger, this.input.db);
      const org = await orgRepo.byId(job.data.organizationId);
      if (!org) {
        throw new Error('Organization not found');
      }

      const organizationMembers = await orgRepo.getMembers({ organizationID: org.id });
      const orgAdmins = organizationMembers.filter((m) => m.rbac.isOrganizationAdmin);

      const intl = Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

      await this.input.mailer.sendOrganizationDeletionQueuedEmail({
        receiverEmails: orgAdmins.map((m) => m.email),
        organizationName: org.name,
        userDisplayName: 'System',
        queuedOnDate: intl.format(new Date(job.data.queuedAt)),
        deletionDate: intl.format(new Date(job.data.deletesAt)),
        restoreLink: `${process.env.WEB_BASE_URL}/${org.slug}/settings`,
      });
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, err },
        `Failed to send organization deletion queued notification`,
      );
      throw err;
    }
  }
}

export const createNotifyOrganizationDeletionQueuedWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
  mailer: Mailer | undefined;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<NotifyOrganizationDeletionQueuedInput>(
    QueueName,
    (job) => new NotifyOrganizationDeletionQueuedWorker(input).handler(job),
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
