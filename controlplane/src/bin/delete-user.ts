import process from 'node:process';
import { drizzle } from 'drizzle-orm/postgres-js';
import { pino } from 'pino';
import postgres from 'postgres';
import { OrganizationRepository } from 'src/core/repositories/OrganizationRepository.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import { UserRepository } from '../core/repositories/UserRepository.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';

const realm = process.env.KC_REALM || 'cosmo';
const loginRealm = process.env.KC_LOGIN_REALM || 'master';
const adminUser = process.env.KC_ADMIN_USER || 'admin';
const adminPassword = process.env.KC_ADMIN_PASSWORD || 'changeme';
const clientId = process.env.KC_CLIENT_ID || 'studio';
const apiUrl = process.env.KC_API_URL || 'http://localhost:8080';

const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';
const databaseTlsCa = process.env.DB_TLS_CA;
const databaseTlsCert = process.env.DB_TLS_CERT;
const databaseTlsKey = process.env.DB_TLS_KEY;

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
  const userRepo = new UserRepository(tx);
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

  // Delete all solo organizations of the user
  const deleteOrgs: Promise<void>[] = [];
  for (const org of soloOrganizations) {
    deleteOrgs.push(
      orgRepo.deleteOrganization(org.id, org.slug, {
        keycloakClient,
        keycloakRealm: realm,
      }),
    );
  }
  await Promise.all(deleteOrgs);
});

// Close database connection
await queryConnection.end({
  timeout: 1,
});
