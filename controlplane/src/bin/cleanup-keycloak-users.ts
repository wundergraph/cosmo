import 'dotenv/config';
import * as process from 'node:process';
import postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { startOfMonth, subDays } from 'date-fns';
import { pino } from 'pino';
import { buildDatabaseConnectionConfig } from '../core/plugins/database.js';
import Keycloak from '../core/services/Keycloak.js';
import * as schema from '../db/schema.js';
import { getConfig } from './get-config.js';

// The way our system works is that when a user logins for the first time (this includes right after signups) or
// is invited to an organization, they are added to the database.

// Number of users to retrieve from Keycloak per page
const NUMBER_OF_USERS_PER_PAGE = 100;
// Any user created after this date will be ignored
const CREATED_NOT_AFTER = startOfMonth(subDays(new Date(), 60));

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

const keycloakClient = new Keycloak({
  apiUrl,
  realm: loginRealm,
  clientId,
  adminUser,
  adminPassword,
  logger: pino(),
});

const findUsersPaged = keycloakClient.client.users.makeRequest<UserQuery, UserRepresentation[]>({
  method: 'GET',
  queryParamKeys: ['first', 'max'],
});

try {
  const start = performance.now();

  // Create the database connection. TLS is optional.
  const connectionConfig = await buildDatabaseConnectionConfig({
    tls:
      databaseTlsCa || databaseTlsCert || databaseTlsKey
        ? { ca: databaseTlsCa, cert: databaseTlsCert, key: databaseTlsKey }
        : undefined,
  });

  const queryConnection = postgres(databaseConnectionUrl, { ...connectionConfig });

  // Ensure Keycloak is up and running
  console.log('Retrieving users from Keycloak...');
  await keycloakClient.authenticateClient();

  // Retrieve all the users paged
  const keycloakUsers = await getKeycloakUsers();
  if (keycloakUsers.length === 0) {
    console.log();
    console.log('All Keycloak users have accepted the terms and conditions!');

    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(0);
  }

  // Retrieve the existing users from the database
  console.log('Retrieving users from database...');

  const db = drizzle(queryConnection, { schema: { ...schema } });
  const dbUsers = await getExistingDatabaseUsers(
    db,
    keycloakUsers.map((user) => user.email),
  );
  await queryConnection.end({
    timeout: 1,
  });

  // Remove any user that exists in Keycloak but doesn't exist in the database
  console.log();
  console.log('Removing Keycloak users not found in the database...');
  const numberOfRemovedUsers = await removeRelevantKeycloakUsers(keycloakUsers, dbUsers);

  // Cleanup completed
  const duration = ((performance.now() - start) / 1000).toFixed(3);
  console.log(`Cleanup completed after ${duration} seconds. A total of ${numberOfRemovedUsers} user(s) were removed.`);
} catch (err) {
  console.error(err);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

async function getKeycloakUsers(): Promise<UserRepresentation[]> {
  const start = performance.now();

  let startIndex = 0;
  const users: UserRepresentation[] = [];
  while (true) {
    const chunkOfUsers = await findUsersPaged({
      first: startIndex,
      max: NUMBER_OF_USERS_PER_PAGE,
      realm,
    });

    // We only want to keep the users that have not verified their email address, not accepted the terms and
    // conditions and were created before `CREATED_NOT_AFTER`
    users.push(
      ...chunkOfUsers.filter((user) => {
        const createdAt = new Date(user.createdTimestamp);
        const needsToAcceptTermsAndConditions =
          user.requiredActions?.some((action) => action === RequiredAction.TERMS_AND_CONDITIONS) ?? false;

        return createdAt < CREATED_NOT_AFTER && user.emailVerified !== true && needsToAcceptTermsAndConditions;
      }),
    );

    if (chunkOfUsers.length < NUMBER_OF_USERS_PER_PAGE) {
      // We reached the end of the users list
      break;
    }

    startIndex += NUMBER_OF_USERS_PER_PAGE;
  }

  const duration = ((performance.now() - start) / 1000).toFixed(3);
  console.log(`\t${users.length} users loaded from Keycloak after ${duration} seconds`);
  return users;
}

async function getExistingDatabaseUsers(db: PostgresJsDatabase<typeof schema>, emails: string[]): Promise<DbUserRepresentation[]> {
  const start = performance.now();
  const users = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(inArray(schema.users.email, emails))
    .execute();

  const duration = ((performance.now() - start) / 1000).toFixed(3);
  console.log(`\t${users.length} users loaded from the database after ${duration} seconds`);
  return users;
}

async function removeRelevantKeycloakUsers(keycloakUsers: UserRepresentation[], dbUsers: DbUserRepresentation[]) {
  let numberOfRemovedUsers = 0;
  for (const user of keycloakUsers) {
    const dbUser = dbUsers.find((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (dbUser) {
      // The user exists in the database, we don't need to delete the Keycloak user
      continue;
    }

    try {
      await keycloakClient.client.users.del({
        id: user.id,
        realm,
      });

      numberOfRemovedUsers++;
      console.log(`\t- User "${user.email}" removed from Keycloak successfully`);
    } catch (err) {
      console.warn(`\t- Failed to remove user "${user.email}" from Keycloak: ${err}`);
    }
  }

  return numberOfRemovedUsers;
}

interface UserQuery {
  first: number;
  max: number;
}

enum RequiredAction {
  TERMS_AND_CONDITIONS = 'TERMS_AND_CONDITIONS',
}

interface UserRepresentation {
  id: string;
  createdTimestamp: number;
  email: string;
  emailVerified?: boolean;
  requiredActions?: RequiredAction[];
}

interface DbUserRepresentation {
  id: string;
  email: string;
}
