import process from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import * as schema from '../db/schema.js';
import Keycloak from '../core/services/Keycloak.js';
import { createDeleteOrganizationWorker, DeleteOrganizationQueue } from '../core/workers/DeleteOrganizationWorker.js';
import { createRedisConnections } from '../core/plugins/redis.js';
import { getConfig } from './get-config.js';

const {
  realm,
  loginRealm,
  adminUser,
  adminPassword,
  clientId,
  apiUrl,
  databaseConnectionUrl,
  databaseTlsCa,
  databaseTlsCert,
  databaseTlsKey,
  organizationSlug,
  redis,
} = getConfig();
const organizationId = process.env.ORGANIZATION_ID || '';
const deactivationReason = process.env.ORGANIZATION_DEACTIVATION_REASON;

// Establish database connection
const connectionConfig = await buildDatabaseConnectionConfig({
  tls:
    databaseTlsCa || databaseTlsCert || databaseTlsKey
      ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
      : undefined,
});
const queryConnection = postgres(databaseConnectionUrl, {
  ...connectionConfig,
  max: 1,
});
const db = drizzle(queryConnection, { schema: { ...schema } });

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

const keycloakClient = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
});
await keycloakClient.authenticateClient();

const logger = pino();

const orgRepo = new OrganizationRepository(logger, db);

const org = await orgRepo.bySlug(organizationSlug);
if (!org) {
  throw new Error('Organization not found');
}

if (org.id !== organizationId) {
  throw new Error('Id and slug mismatch');
}

const deleteOrganizationQueue = new DeleteOrganizationQueue(logger, redisQueue);

const worker = createDeleteOrganizationWorker({
  redisConnection: redisWorker,
  db,
  logger,
  keycloakClient,
  keycloakRealm: realm,
});

await orgRepo.reactivateOrganization({
  organizationId,
  deleteOrganizationQueue,
});

await worker.close();

redisQueue.disconnect();
redisWorker.disconnect();

// Close database connection
await queryConnection.end({
  timeout: 1,
});
