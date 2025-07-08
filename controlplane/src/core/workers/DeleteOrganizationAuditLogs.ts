import { ConnectionOptions, Job, JobsOptions } from 'bullmq';
import pino from 'pino';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';
import { DB } from '../../db/index.js';
import { BaseQueue, BaseWorker } from './base/index.js';

const QueueName = 'organization.delete_audit_logs';
const WorkerName = 'DeleteOrganizationAuditLogsWorker';

export interface DeleteOrganizationAuditLogsInput {
  organizationId: string;
}

export class DeleteOrganizationAuditLogsQueue extends BaseQueue<DeleteOrganizationAuditLogsInput> {
  constructor(log: pino.Logger, conn: ConnectionOptions) {
    super({ name: QueueName, log, conn });
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

export class DeleteOrganizationAuditLogsWorker extends BaseWorker<DeleteOrganizationAuditLogsInput> {
  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: DB;
      logger: pino.Logger;
    },
  ) {
    super(WorkerName, QueueName, { connection: input.redisConnection, concurrency: 10 }, input.logger);
  }

  protected async handler(job: Job<DeleteOrganizationAuditLogsInput>) {
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
      throw err;
    }
  }
}
