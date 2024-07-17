// See https://github.com/keycloak/keycloak/tree/main/js/libs/keycloak-admin-client

import { randomUUID } from 'node:crypto';
import * as process from 'node:process';
import postgres from 'postgres';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import Keycloak from '../core/services/Keycloak.js';
import { seedTest } from '../core/test-util.js';
import { getConfig } from './get-config.js';

const {
  realm,
  loginRealm,
  adminUser,
  adminPassword,
  clientId,
  apiUrl,
  apiKey,
  userEmail,
  userPassword,
  userFirstName,
  userLastName,
  organizationName,
  organizationSlug,
  databaseConnectionUrl,
  databaseTlsCa,
  databaseTlsCert,
  databaseTlsKey,
} = getConfig();

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
    roles: ['admin'],
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
