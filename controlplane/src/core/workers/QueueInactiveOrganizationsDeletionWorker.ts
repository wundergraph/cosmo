import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import pino from 'pino';
import { addDays, startOfMonth, subDays } from 'date-fns';
import { and, count, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import Keycloak from '../services/Keycloak.js';
import { IQueue, IWorker } from './Worker.js';
import type { NotifyOrganizationDeletionQueuedQueue } from './NotifyOrganizationDeletionQueuedWorker.js';
import type { DeleteOrganizationQueue } from './DeleteOrganizationWorker.js';

const QueueName = 'organization.queue-inactive-organizations-queue';
const WorkerName = 'QueueInactiveOrganizationWorker';

// The number of days the organization needs to be inactive for before we consider it for deletion
const MIN_INACTIVITY_DAYS = 90;

// How long should we wait before deleting the organization?
const DELAY_FOR_ORG_DELETION_IN_DAYS = 7;

export interface QueueInactiveOrganizationsDeletionInput {}

export class QueueInactiveOrganizationsDeletionQueue implements IQueue<QueueInactiveOrganizationsDeletionInput> {
  private readonly queue: Queue<QueueInactiveOrganizationsDeletionInput>;
  private readonly logger: pino.Logger;

  constructor(log: pino.Logger, conn: ConnectionOptions) {
    this.logger = log.child({ queue: QueueName });
    this.queue = new Queue<QueueInactiveOrganizationsDeletionInput>(QueueName, {
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

  public addJob(
    _job: QueueInactiveOrganizationsDeletionInput,
    _opts?: Omit<JobsOptions, 'jobId'>,
  ): Promise<Job<QueueInactiveOrganizationsDeletionInput>> {
    throw new Error('This method should not be called directly.');
  }

  public removeJob(_job: QueueInactiveOrganizationsDeletionInput) {
    return Promise.resolve(0);
  }

  public getJob(_job: QueueInactiveOrganizationsDeletionInput): Promise<Job<QueueInactiveOrganizationsDeletionInput>> {
    throw new Error('This method should not be called directly.');
  }

  public scheduleJob() {
    return this.queue.upsertJobScheduler(
      WorkerName,
      {
        pattern: '0 0 0 1 * *',
      },
      {
        name: '',
        data: {},
        opts: {},
      },
    );
  }
}

class QueueInactiveOrganizationsDeletionWorker implements IWorker {
  private readonly orgRepo: OrganizationRepository;

  constructor(
    private input: {
      redisConnection: ConnectionOptions;
      db: PostgresJsDatabase<typeof schema>;
      realm: string;
      keycloak: Keycloak;
      deleteOrganizationQueue: DeleteOrganizationQueue;
      notifyOrganizationDeletionQueuedQueue: NotifyOrganizationDeletionQueuedQueue;
      logger: pino.Logger;
    },
  ) {
    this.input.logger = input.logger.child({ worker: WorkerName });
    this.orgRepo = new OrganizationRepository(this.input.logger, this.input.db);
  }

  public async handler(_job: Job<QueueInactiveOrganizationsDeletionInput>) {
    const now = new Date();
    const inactivityThreshold = startOfMonth(subDays(now, MIN_INACTIVITY_DAYS));
    const deletesAt = addDays(now, DELAY_FOR_ORG_DELETION_IN_DAYS);

    // Retrieve all the organizations that only have a single user
    const orgsWithSingleUser = await this.retrieveOrganizationsWithSingleUser(inactivityThreshold);
    if (orgsWithSingleUser.length === 0) {
      this.input.logger.debug('No organizations with single user found');
      return;
    }

    // Process all the organizations with a single user
    await this.input.keycloak.authenticateClient();
    for (const org of orgsWithSingleUser) {
      if (!org.userId) {
        // Should never be the case but to prevent TypeScript from complaining, we still need to ensure
        // that the value exists
        continue;
      }

      // First, we check whether the organization has had any activity registered in the audit logs in the
      // last `MIN_INACTIVITY_DAYS` days
      const auditLogs = await this.input.db
        .select({ count: count() })
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.organizationId, org.id), gte(schema.auditLogs.createdAt, inactivityThreshold)))
        .execute();

      if (auditLogs.length > 0 && auditLogs[0].count > 0) {
        // The organization has had activity registered in the audit, at least once in the last `MIN_INACTIVITY_DAYS` days,
        // so we don't need to consider it for deletion
        continue;
      }

      // If the organization hasn't had any activity, we should check the last time the user logged in
      try {
        const userSessions = await this.input.keycloak.client.users.listSessions({
          id: org.userId,
          realm: this.input.realm,
        });

        const numberOfSessionsRecentlyActive = userSessions.filter(
          (sess) => (sess.lastAccess || sess.start) && new Date(sess.lastAccess || sess.start!) >= inactivityThreshold,
        ).length;

        if (numberOfSessionsRecentlyActive > 0) {
          // The user has been active at least once in the last `MIN_INACTIVITY_DAYS` days, so we don't need
          // to consider it for deletion
          continue;
        }
      } catch (error) {
        // Failed to fetch the user sessions, skip for now
        this.input.logger.error(error, 'Failed to retrieve user sessions');
        continue;
      }

      // It seems like the organization (and the user) hasn't been active recently, flag the organization for deletion
      this.input.logger.info(`Queuing organization "${org.slug}" for deletion at ${deletesAt.toISOString()}`);
      await this.queueForDeletion(org.id, now, deletesAt);
    }
  }

  private async queueForDeletion(orgId: string, queuedAt: Date, deletesAt: Date) {
    // Enqueue the organization deletion job
    await this.orgRepo.queueOrganizationDeletion({
      organizationId: orgId,
      queuedBy: undefined,
      deleteOrganizationQueue: this.input.deleteOrganizationQueue,
      deleteDelayInDays: DELAY_FOR_ORG_DELETION_IN_DAYS,
    });

    // Queue the organization deletion notification job
    await this.input.notifyOrganizationDeletionQueuedQueue.addJob({
      organizationId: orgId,
      queuedAt: Number(queuedAt),
      deletesAt: Number(deletesAt),
    });
  }

  private retrieveOrganizationsWithSingleUser(createdBefore: Date) {
    return this.input.db
      .select({
        id: schema.organizations.id,
        slug: schema.organizations.slug,
        userId: schema.organizations.createdBy,
        plan: schema.organizationBilling.plan,
      })
      .from(schema.organizations)
      .innerJoin(schema.organizationsMembers, eq(schema.organizationsMembers.organizationId, schema.organizations.id))
      .leftJoin(schema.organizationBilling, eq(schema.organizationBilling.organizationId, schema.organizations.id))
      .where(
        and(
          isNull(schema.organizations.queuedForDeletionAt),
          eq(schema.organizations.isDeactivated, false),
          lt(schema.organizations.createdAt, createdBefore),
          or(isNull(schema.organizationBilling.plan), eq(schema.organizationBilling.plan, 'developer')),
        ),
      )
      .groupBy(schema.organizations.id, schema.organizationBilling.plan)
      .having(sql`COUNT(${schema.organizationsMembers.id}) = 1`)
      .execute();
  }
}

export function createQueueInactiveOrganizationsDeletionWorker(input: {
  redisConnection: ConnectionOptions;
  db: PostgresJsDatabase<typeof schema>;
  realm: string;
  keycloak: Keycloak;
  deleteOrganizationQueue: DeleteOrganizationQueue;
  notifyOrganizationDeletionQueuedQueue: NotifyOrganizationDeletionQueuedQueue;
  logger: pino.Logger;
}) {
  const log = input.logger.child({ worker: WorkerName });
  const worker = new Worker<QueueInactiveOrganizationsDeletionInput>(
    QueueName,
    (job) => new QueueInactiveOrganizationsDeletionWorker(input).handler(job),
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
}
