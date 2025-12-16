import 'dotenv/config';

import process from 'node:process';
import { subDays, startOfMonth, addDays } from 'date-fns';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, count, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import * as schema from '../db/schema.js';
import { DeleteOrganizationQueue } from '../core/workers/DeleteOrganizationWorker.js';
import { createRedisConnections } from '../core/plugins/redis.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import { NotifyOrganizationDeletionQueuedQueue } from '../core/workers/NotifyOrganizationDeletionQueuedWorker.js';
import { getConfig } from './get-config.js';

// Number of concurrent tasks. We'll allocate the same number of database connections + 1, so keep this number reasonable
const MAX_DEGREE_OF_PARALLELISM = 5;

// How many organizations to retrieve from the database to migrate in a transaction. This is used to not load
// all organizations at once and perform the migration in buckets
const ORGANIZATIONS_PER_BUCKET = 100;

// The number of days the organization needs to be inactive for before we consider it for deletion
const MIN_INACTIVITY_DAYS = 90;

// How long should we wait before deleting the organization?
const DELAY_FOR_ORG_DELETION_IN_DAYS = 7;

const { databaseConnectionUrl, databaseTlsCa, databaseTlsCert, databaseTlsKey, redis } = getConfig();

try {
  const connectionConfig = await buildDatabaseConnectionConfig({
    tls:
      databaseTlsCa || databaseTlsCert || databaseTlsKey
        ? {
            ca: databaseTlsCa,
            cert: databaseTlsCert,
            key: databaseTlsKey,
          }
        : undefined,
  });
  const queryConnection = postgres(databaseConnectionUrl, {
    ...connectionConfig,
    max: MAX_DEGREE_OF_PARALLELISM + 1,
  });

  // Initialize the Redis connection
  const { redisQueue, redisWorker } = await createRedisConnections({
    host: redis.host!,
    port: Number(redis.port),
    password: redis.password,
    tls: redis.tls,
  });

  await redisQueue.connect();
  await redisWorker.connect();
  await redisWorker.ping();
  await redisQueue.ping();

  try {
    const logger = pino();
    const db = drizzle(queryConnection, { schema: { ...schema } });

    await queueOrganizationsForDeletion({
      db,
      deleteOrganizationQueue: new DeleteOrganizationQueue(logger, redisQueue),
      notifyOrganizationDeletionQueuedQueue: new NotifyOrganizationDeletionQueuedQueue(logger, redisQueue),
    });
  } finally {
    redisQueue.disconnect();
    redisWorker.disconnect();

    // Close the database connection
    await queryConnection.end({
      timeout: 1,
    });
  }

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

function chunkArray<T>(data: T[]): T[][] {
  // @ts-ignore
  if (MAX_DEGREE_OF_PARALLELISM === 1) {
    return [data];
  }

  const chunks: T[][] = [];
  const organizationsPerChunk = Math.ceil(ORGANIZATIONS_PER_BUCKET / MAX_DEGREE_OF_PARALLELISM);
  for (let i = 0; i < data.length; i += organizationsPerChunk) {
    chunks.push(data.slice(i, i + organizationsPerChunk));
  }

  return chunks;
}

async function queueOrganizationsForDeletion({
  db,
  deleteOrganizationQueue,
  notifyOrganizationDeletionQueuedQueue,
}: {
  db: PostgresJsDatabase<typeof schema>;
  deleteOrganizationQueue: DeleteOrganizationQueue;
  notifyOrganizationDeletionQueuedQueue: NotifyOrganizationDeletionQueuedQueue;
}) {
  // First, retrieve all the organizations that only have a single user and have not had any activity registered in
  // the audit log for the last `MIN_INACTIVITY_DAYS` days
  const now = new Date();
  const inactivityThreshold = startOfMonth(subDays(now, MIN_INACTIVITY_DAYS));

  console.log(`Retrieving organizations with a single member...`);
  const organizations = await db
    .select({
      id: schema.organizations.id,
      slug: schema.organizations.slug,
      userId: schema.organizations.createdBy,
    })
    .from(schema.organizations)
    .innerJoin(schema.organizationsMembers, eq(schema.organizationsMembers.organizationId, schema.organizations.id))
    .where(
      and(isNull(schema.organizations.queuedForDeletionAt), lt(schema.organizations.createdAt, inactivityThreshold)),
    )
    .groupBy(schema.organizations.id)
    .having(sql`COUNT(${schema.organizationsMembers.id}) = 1`)
    .execute();

  if (organizations.length === 0) {
    console.log('No organizations found with a single member');
    return;
  }

  console.log(`${organizations.length} organizations with a single member found`);

  // Break the organizations in chunk so we can have some degree of parallelism
  console.log('Processing organizations...');
  await Promise.all(
    chunkArray(organizations).map((chunk) =>
      db.transaction((tx) => {
        return processChunkOfOrganizations({
          organizations: chunk,
          db: tx,
          inactivityThreshold,
          deleteOrganizationQueue,
          notifyOrganizationDeletionQueuedQueue,
        });
      }),
    ),
  );

  console.log('Done!');
}

async function processChunkOfOrganizations({
  organizations,
  db,
  inactivityThreshold,
  deleteOrganizationQueue,
  notifyOrganizationDeletionQueuedQueue,
}: {
  organizations: { id: string; slug: string; userId: string | null }[];
  db: PostgresJsDatabase<typeof schema>;
  inactivityThreshold: Date;
  deleteOrganizationQueue: DeleteOrganizationQueue;
  notifyOrganizationDeletionQueuedQueue: NotifyOrganizationDeletionQueuedQueue;
}) {
  const queuedAt = new Date();
  const deletesAt = addDays(queuedAt, DELAY_FOR_ORG_DELETION_IN_DAYS);

  const orgRepo = new OrganizationRepository(pino(), db, undefined);
  for (const org of organizations) {
    const auditLogs = await db
      .select({ count: count() })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.organizationId, org.id), gte(schema.auditLogs.createdAt, inactivityThreshold)))
      .execute();

    if (auditLogs.length > 0 && auditLogs[0].count > 0) {
      // The organization has had activity registered in the audit, at least once in the last `MIN_INACTIVITY_DAYS` days,
      // so we don't need to consider it for deletion
      continue;
    }

    console.log(`\tEnqueuing organization "${org.slug}" for deletion at ${deletesAt.toISOString()}...`);

    // Enqueue the organization deletion job
    await orgRepo.queueOrganizationDeletion({
      organizationId: org.id,
      queuedBy: undefined,
      deleteOrganizationQueue,
      deleteDelayInDays: DELAY_FOR_ORG_DELETION_IN_DAYS,
    });

    // Queue the organization deletion notification job
    await notifyOrganizationDeletionQueuedQueue.addJob({
      organizationId: org.id,
      queuedAt: queuedAt.getTime(),
      deletesAt: deletesAt.getTime(),
    });
  }
}
