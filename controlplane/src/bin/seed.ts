// See https://github.com/keycloak/keycloak/tree/main/js/libs/keycloak-admin-client

import { randomUUID } from 'node:crypto';
import * as process from 'node:process';
import postgres from 'postgres';
import { seedTest } from '../core/test-util.js';
import Keycloak from '../core/services/Keycloak.js';
import { ApiKeyGenerator } from '../core/services/ApiGenerator.js';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';

const realm = process.env.KC_REALM || 'cosmo';
const loginRealm = process.env.KC_LOGIN_REALM || 'master';
const adminUser = process.env.KC_ADMIN_USER || 'admin';
const adminPassword = process.env.KC_ADMIN_PASSWORD || 'changeme';
const clientId = process.env.KC_CLIENT_ID || 'studio';
const apiUrl = process.env.KC_API_URL || 'http://localhost:8080';

const apiKey = process.env.API_KEY || ApiKeyGenerator.generate();

const userEmail = process.env.USER_EMAIL || 'foo@wundergraph.com';
const userPassword = process.env.USER_PASSWORD || 'wunder@123';
const userFirstName = process.env.USER_FIRST_NAME || 'foo';
const userLastName = process.env.USER_LAST_NAME || 'bar';

const organizationName = process.env.ORGANIZATION_NAME || 'wundergraph';
const organizationSlug = process.env.ORGANIZATION_SLUG || 'wundergraph';
const databaseConnectionUrl = process.env.DB_URL || 'postgresql://postgres:changeme@localhost:5432/controlplane';
const databaseTlsCa = process.env.DB_TLS_CA;
const databaseTlsCert = process.env.DB_TLS_CERT;
const databaseTlsKey = process.env.DB_TLS_KEY;

const keycloakClient = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
});

const user = {
  email: userEmail,
  password: userPassword,
  firstName: userFirstName,
  lastName: userLastName,
  organization: {
    name: organizationName,
    slug: organizationSlug,
  },
};

const organizationId = randomUUID();

try {
  // Ensure keycloak is up and running
  await keycloakClient.authenticateClient();

  // Create database connection. TLS is optionally.
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

  // Ensure that the database is up and running
  await queryConnection`SELECT 1 FROM users;`;

  const users = await keycloakClient.client.users.find({
    realm,
    email: user.email,
  });

  if (users.length > 0) {
    console.log('User already exists');
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  const organizationGroup = await keycloakClient.client.groups.create({
    realm,
    name: user.organization.slug,
  });

  const adminGroup = await keycloakClient.client.groups.createChildGroup(
    {
      realm,
      id: organizationGroup.id,
    },
    {
      name: 'admin',
      realmRoles: ['admin'],
    },
  );

  const devGroup = await keycloakClient.client.groups.createChildGroup(
    {
      realm,
      id: organizationGroup.id,
    },
    {
      name: 'developer',
      realmRoles: ['developer'],
    },
  );

  const viewerGroup = await keycloakClient.client.groups.createChildGroup(
    {
      realm,
      id: organizationGroup.id,
    },
    {
      name: 'viewer',
      realmRoles: ['viewer'],
    },
  );

  const keycloakUserID = await keycloakClient.addKeycloakUser({
    realm,
    email: user.email,
    password: user.password,
    isPasswordTemp: false,
  });

  await keycloakClient.client.users.addToGroup({
    id: keycloakUserID,
    realm,
    groupId: adminGroup.id,
  });

  await seedTest(queryConnection, {
    apiKey,
    email: user.email,
    organizationName: user.organization.name,
    organizationSlug: user.organization.slug,
    userId: keycloakUserID,
    organizationId,
  });

  await queryConnection.end({
    timeout: 1,
  });

  console.log(`User created with id ${keycloakUserID}, email "${user.email}"`);
  console.log(`API Key: ${apiKey}`);

  console.log('Done');

  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(0);
} catch (err: any) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}
