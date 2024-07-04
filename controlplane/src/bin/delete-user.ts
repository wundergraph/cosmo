import process from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { UserRepository } from '../core/repositories/UserRepository.js';
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

// Find user on keycloak
const user = await keycloakClient.client.users.findOne({
  realm,
  id: userId,
});

await db.transaction(async (tx) => {
  const userRepo = new UserRepository(pino(), tx);
  const orgRepo = new OrganizationRepository(pino(), tx);

  if (!user || !user.id) {
    throw new Error('User not found');
  }

  // Check if user can be deleted
  const { isSafe, soloOrganizations, unsafeOrganizations } = await orgRepo.canUserBeDeleted(user.id);
  console.log(`::set-output name=soloOrganizations::${JSON.stringify(soloOrganizations)}`);
  console.log(`::set-output name=unsafeOrganizations::${JSON.stringify(unsafeOrganizations)}`);

  if (!isSafe) {
    throw new Error('Cannot delete user because they are the only admin of an organization with several members.');
  }

  // Delete the user
  await userRepo.deleteUser({
    id: user.id,
    keycloakClient,
    keycloakRealm: realm,
  });
});

// Close database connection
await queryConnection.end({
  timeout: 1,
});
