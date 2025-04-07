import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';
import { IQueue, IWorker } from './Worker.js';

const QueueName = 'organization.delete_audit_logs';
const WorkerName = 'DeleteOrganizationAuditLogsWorker';

export interface DeleteOrganizationAuditLogsInput {
  organizationId: string;
}

export class DeleteOrganizationAuditLogsQueue implements IQueue<DeleteOrganizationAuditLogsInput> {
  private readonly queue: Queue<DeleteOrganizationAuditLogsInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<DeleteOrganizationAuditLogsInput>(QueueName, {
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

  public addJob(job: DeleteOrganizationAuditLogsInput, opts?: Omit<JobsOptions, 'jobId'>) {
    return this.queue.add(job.organizationId, job, {
      ...opts,
      jobId: job.organizationId,
    });
  }

  public removeJob(job: DeleteOrganizationAuditLogsInput) {
    return this.queue.remove(job.organizationId);
  }

  public getJob(job: DeleteOrganizationAuditLogsInput) {
    return this.queue.getJob(job.organizationId);
  }
}

class DeleteOrganizationAuditLogsWorker implements IWorker {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      logger: pino.Logger;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
  }

  public async handler(job: Job<DeleteOrganizationAuditLogsInput>) {
    try {
      const auditLogRepo = new AuditLogRepository(this.input.db);

      await auditLogRepo.deleteOrganizationLogs({
        organizationId: job.data.organizationId,
      });
    } catch (err) {
      this.input.logger.error(
        { jobId: job.id, organizationId: job.data.organizationId, err },
        'Failed to delete audit logs for organization',
      );
    }
  }
}

export const createDeleteOrganizationAuditLogsWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<DeleteOrganizationAuditLogsInput>(
    QueueName,
    (job) => new DeleteOrganizationAuditLogsWorker(input).handler(job),
    {
      connection: input.redisConnection,
      concurrency: 10,
    },
  );

  worker.on('stalled', (job) => {
    log.warn({ joinId: job }, 'Job stalled');
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });

  return worker;
};
