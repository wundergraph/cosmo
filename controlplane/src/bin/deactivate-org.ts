import process from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
import * as schema from '../db/schema.js';
import Keycloak from '../core/services/Keycloak.js';
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

await orgRepo.deactivateOrganization({
  organizationId,
  reason: deactivationReason,
  keycloakClient,
  keycloakRealm: realm,
});

// Close database connection
await queryConnection.end({
  timeout: 1,
});
