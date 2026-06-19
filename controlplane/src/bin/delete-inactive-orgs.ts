import 'dotenv/config';
import process from 'node:process';
import { and, count, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { pino } from 'pino';
import { addDays, startOfMonth, subDays } from 'date-fns';
import * as schema from '../db/schema.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { createRedisConnections } from '../core/plugins/redis.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import { DeleteOrganizationQueue } from '../core/workers/DeleteOrganizationWorker.js';
import { NotifyOrganizationDeletionQueuedQueue } from '../core/workers/NotifyOrganizationDeletionQueuedWorker.js';
import Keycloak from '../core/services/Keycloak.js';
import { getConfig } from './get-config.js';

// The number of days the organization needs to be inactive for before we consider it for deletion
const MIN_INACTIVITY_DAYS = 90;

// How long should we wait before deleting the organization?
const DELAY_FOR_ORG_DELETION_IN_DAYS = 7;

const {
  realm,
  loginRealm,
  apiUrl,
  adminUser,
  adminPassword,
  clientId,
  databaseConnectionUrl,
  databaseTlsCa,
  databaseTlsCert,
  databaseTlsKey,
  redis,
} = getConfig();

// Create the redis connection.
const { redisQueue, redisWorker } = await createRedisConnections({
  host: redis.host!,
  port: Number(redis.port),
  password: redis.password,
  tls: redis.tls,
});

// Create the database connection. TLS is optional.
const connectionConfig = await buildDatabaseConnectionConfig({
  tls:
    databaseTlsCa || databaseTlsCert || databaseTlsKey
      ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
      : undefined,
});

const queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig });

// Initialize all required services
const logger = pino();
const db = drizzle(queryConnection, { schema: { ...schema } });
const keycloak = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
  logger: pino(),
});

const orgRepo = new OrganizationRepository(logger, db);
const deleteOrganizationQueue = new DeleteOrganizationQueue(logger, redisQueue);
const notifyOrganizationDeletionQueuedQueue = new NotifyOrganizationDeletionQueuedQueue(logger, redisQueue);

// Do the work!
try {
  const now = new Date();
  const inactivityThreshold = startOfMonth(subDays(now, MIN_INACTIVITY_DAYS));
  const deletesAt = addDays(now, DELAY_FOR_ORG_DELETION_IN_DAYS);

  // Retrieve all the organizations that only have a single user
  const orgsWithSingleUser = await retrieveOrganizationsWithSingleUser(inactivityThreshold);
  if (orgsWithSingleUser.length === 0) {
    console.log('No organizations with single user found');
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  // Process all the organizations with a single user
  await keycloak.authenticateClient();
  for (const org of orgsWithSingleUser) {
    if (!org.userId) {
      // Should never be the case but to prevent TypeScript from complaining, we still need to ensure
      // that the value exists
      continue;
    }

    // First, we check whether the organization has had any activity registered in the audit logs in the
    // last `MIN_INACTIVITY_DAYS` days
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

    // If the organization hasn't had any activity, we should check the last time the user logged in
    try {
      const userSessions = await keycloak.client.users.listSessions({
        id: org.userId,
        realm,
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
      console.error(error, `Failed to retrieve sessions for user: ${org.userId}`);
      continue;
    }

    // It seems like the organization (and the user) hasn't been active recently, flag the organization for deletion
    console.log(`Queuing organization "${org.slug}" for deletion at ${deletesAt.toISOString()}`);
    await queueForDeletion(org.id, now, deletesAt);
  }
} catch (err: unknown) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
} finally {
  redisQueue.disconnect();
  redisWorker.disconnect();

  await queryConnection.end({ timeout: 1 });
}

async function queueForDeletion(orgId: string, queuedAt: Date, deletesAt: Date) {
  // Enqueue the organization deletion job
  await orgRepo.queueOrganizationDeletion({
    organizationId: orgId,
    queuedBy: undefined,
    deleteOrganizationQueue,
    deleteDelayInDays: DELAY_FOR_ORG_DELETION_IN_DAYS,
  });

  // Queue the organization deletion notification job
  await notifyOrganizationDeletionQueuedQueue.addJob({
    organizationId: orgId,
    queuedAt: Number(queuedAt),
    deletesAt: Number(deletesAt),
  });
}

function retrieveOrganizationsWithSingleUser(createdBefore: Date) {
  return db
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
