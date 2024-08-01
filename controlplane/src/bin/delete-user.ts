import process from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import postgres from 'postgres';
import { PlatformEventName } from '@wundergraph/cosmo-connect/dist/notifications/events_pb';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { UserRepository } from '../core/repositories/UserRepository.js';
import { PlatformWebhookService } from '../core/webhooks/PlatformWebhookService.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';
import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
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
  webhookUrl,
  webhookSecret,
} = getConfig();

const userId = process.env.USER_ID || '';

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

// Authenticate with keycloak
const keycloakClient = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
});
await keycloakClient.authenticateClient();

const logger = pino();

// Init platform webhooks
const platformWebhooks = new PlatformWebhookService(webhookUrl, webhookSecret, logger);

// Find user on keycloak
const user = await keycloakClient.client.users.findOne({
  realm,
  id: userId,
});

const userRepo = new UserRepository(logger, db);
const orgRepo = new OrganizationRepository(logger, db);

if (!user || !user.id || !user.email) {
  throw new Error('User not found');
}

// Check if user can be deleted
const { isSafe, soloOrganizations, unsafeOrganizations } = await orgRepo.canUserBeDeleted(user.id);

console.log(`soloOrganizations=${JSON.stringify(soloOrganizations)}\n`);
console.log(`unsafeOrganizations=${JSON.stringify(unsafeOrganizations)}\n`);

if (!isSafe) {
  throw new Error('Cannot delete user because they are the only admin of an organization with several members.');
}

// Delete the user
await userRepo.deleteUser({
  id: user.id,
  keycloakClient,
  keycloakRealm: realm,
});

platformWebhooks.send(PlatformEventName.USER_DELETE_SUCCESS, {
  user_id: user.id,
  user_email: user.email!,
});

// Close database connection
await queryConnection.end({
  timeout: 1,
});
