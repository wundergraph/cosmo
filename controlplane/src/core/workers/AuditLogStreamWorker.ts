import { ConnectionOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import * as schema from '../../db/schema.js';
import { sendToHec, toHecEvent } from '../audit-log-stream/splunk-hec.js';
import { AuditLogStreamConfig, AuditLogStreamRepository } from '../repositories/AuditLogStreamRepository.js';

const QueueName = 'organization.audit_log_stream';
const WorkerName = 'AuditLogStreamWorker';
const SchedulerId = 'audit-log-stream-tick';

const TICK_INTERVAL_MS = 30_000;
const BATCH_SIZE = 100;
// Bounds how long one tick spends on a single organization, so a large backlog doesn't starve the others.
const MAX_BATCHES_PER_TICK = 20;

export class AuditLogStreamQueue {
  private readonly queue: Queue;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    const logger = log.child({ queue: QueueName });
    this.queue = new Queue(QueueName, {
      connection: conn,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: { age: 86_400 },
      },
    });

    this.queue.on('error', (err) => {
      logger.error(err, 'Queue error');
    });
  }

  /**
   * Registers the repeating tick. Upserting by id means every controlplane replica can call this on boot and only one
   * schedule exists.
   */
  public schedule() {
    return this.queue.upsertJobScheduler(SchedulerId, { every: TICK_INTERVAL_MS }, { name: SchedulerId });
  }
}

/**
 * Delivers one organization's pending audit logs. Stops at the first failure and leaves the cursor in place, so the
 * next tick retries from the same point.
 */
export async function deliverAuditLogs(input: {
  repo: AuditLogStreamRepository;
  config: AuditLogStreamConfig;
  logger: pino.Logger;
}) {
  const { repo, config, logger } = input;

  for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
    const logs = await repo.getPendingLogs(config.organizationId, BATCH_SIZE);
    const last = logs.at(-1);
    if (!last) {
      return;
    }

    const error = await sendToHec(
      config,
      logs.map((log) => toHecEvent(log, config)),
    );
    if (error) {
      logger.warn({ organizationId: config.organizationId, err: error }, 'Failed to stream audit logs');
      await repo.recordError(config.organizationId, error);
      return;
    }

    await repo.recordSuccess(config.organizationId, last.id);

    if (logs.length < BATCH_SIZE) {
      return;
    }
  }
}

export const createAuditLogStreamWorker = (input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  logger: pino.Logger;
}) => {
  const log = input.logger.child({ worker: WorkerName });
  const repo = new AuditLogStreamRepository(input.db);

  const worker = new Worker(
    QueueName,
    async () => {
      const configs = await repo.listEnabled();
      for (const config of configs) {
        try {
          await deliverAuditLogs({ repo, config, logger: log });
        } catch (err: unknown) {
          log.error({ organizationId: config.organizationId, err }, 'Audit log stream delivery failed');
        }
      }
    },
    {
      connection: input.redisConnection,
      // A single tick at a time keeps cursor updates ordered.
      concurrency: 1,
    },
  );

  worker.on('stalled', (jobId) => {
    log.warn({ jobId }, 'Job stalled');
  });
  worker.on('error', (err) => {
    log.error(err, 'Worker error');
  });

  return worker;
};
