// import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
// import { drizzle } from 'drizzle-orm/postgres-js';
// import { pino } from 'pino';
// import postgres from 'postgres';
// import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
// import { ApiKeyRepository } from '../core/repositories/ApiKeyRepository.js';
// import { OrganizationRepository } from '../core/repositories/OrganizationRepository.js';
// import { UserRepository } from '../core/repositories/UserRepository.js';
// import Keycloak from '../core/services/Keycloak.js';
// import * as schema from '../db/schema.js';
// import { getConfig } from './get-config.js';

// const {
//   realm,
//   loginRealm,
//   adminUser,
//   adminPassword,
//   clientId,
//   apiUrl,
//   apiKey,
//   userEmail,
//   userPassword,
//   organizationSlug,
//   databaseConnectionUrl,
//   databaseTlsCa,
//   databaseTlsCert,
//   databaseTlsKey,
// } = getConfig();

// const keycloakClient = new Keycloak({
//   apiUrl,
//   realm: loginRealm,
//   clientId,
//   adminUser,
//   adminPassword,
// });

// await keycloakClient.authenticateClient();

// const connectionConfig = await buildDatabaseConnectionConfig({
//   tls:
//     databaseTlsCa || databaseTlsCert || databaseTlsKey
//       ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
//       : undefined,
// });
// const queryConnection = postgres(databaseConnectionUrl, {
//   ...connectionConfig,
//   max: 1,
// });

// const groups = await keycloakClient.client.groups.find({
//   realm,
//   search: organizationSlug,
// });

// const adminGroup = groups[0];
// const keycloakUserID = await keycloakClient.addKeycloakUser({
//   realm,
//   email: userEmail,
//   password: userPassword,
//   isPasswordTemp: false,
// });

// await keycloakClient.client.users.addToGroup({
//   id: keycloakUserID,
//   realm,
//   groupId: adminGroup.id!,
// });

// const db = drizzle(queryConnection, { schema: { ...schema } });
// const userRepo = new UserRepository(pino(), db);
// const orgRepo = new OrganizationRepository(pino(), db, undefined);
// const apiKeyRepo = new ApiKeyRepository(db);

// await userRepo.addUser({
//   id: keycloakUserID,
//   email: userEmail,
// });

// const org = await orgRepo.bySlug(organizationSlug);
// const orgMember = await orgRepo.addOrganizationMember({
//   organizationID: org!.id,
//   userID: keycloakUserID,
// });

// await orgRepo.addOrganizationMemberRoles({
//   memberID: orgMember.id,
//   roles: ['admin'],
// });

// await apiKeyRepo.addAPIKey({
//   key: apiKey,
//   name: userEmail,
//   organizationID: org!.id,
//   userID: keycloakUserID,
//   expiresAt: ExpiresAt.NEVER,
//   targetIds: [],
//   permissions: [],
// });

// await queryConnection.end({
//   timeout: 1,
// });
