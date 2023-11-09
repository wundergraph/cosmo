import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import nuid from 'nuid';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuthContext, Label } from '../types/index.js';
import * as schema from '../db/schema.js';
import { Authenticator } from './services/Authentication.js';
import { UserRepository } from './repositories/UserRepository.js';
import { OrganizationRepository } from './repositories/OrganizationRepository.js';
import { GraphKeyAuthContext } from './services/GraphApiTokenAuthenticator.js';

export type UserTestData = {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  email: string;
  apiKey: string;
};

export async function beforeAllSetup(): Promise<string> {
  const dbname = nuid.next();
  const sql = postgres('postgresql://postgres:changeme@localhost:5432/postgres', { max: 1 });
  await sql`CREATE DATABASE "${sql.unsafe(dbname)}";`;
  await sql.end();

  return dbname;
}

export async function afterAllSetup(dbname: string) {
  const sql = postgres('postgresql://postgres:changeme@localhost:5432/postgres');
  await sql`DROP DATABASE "${sql.unsafe(dbname)}";`;
  await sql.end({ timeout: 3 });
}

export function genID(prefix = 'prefix') {
  return prefix + '-' + nuid.next();
}

export function genUniqueLabel(prefix = 'prefix'): Label {
  return { key: prefix + '-' + genID(), value: genID() };
}

export async function seedTest(databaseConnectionUrl: string, userTestData: UserTestData) {
  const queryConnection = postgres(databaseConnectionUrl);
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const userRepo = new UserRepository(db);
  const orgRepo = new OrganizationRepository(db);

  await userRepo.addUser({
    id: userTestData.userId,
    email: userTestData.email,
  });

  const insertedOrg = await orgRepo.createOrganization({
    organizationID: userTestData.organizationId,
    organizationName: userTestData.organizationName,
    organizationSlug: userTestData.organizationSlug,
    ownerID: userTestData.userId,
  });

  const orgMember = await orgRepo.addOrganizationMember({
    organizationID: insertedOrg.id,
    userID: userTestData.userId,
    acceptedInvite: true,
  });

  await orgRepo.addOrganizationMemberRoles({
    memberID: orgMember.id,
    roles: ['admin'],
  });

  await orgRepo.addAPIKey({
    key: userTestData.apiKey,
    name: 'myAdminKey',
    organizationID: insertedOrg.id,
    userID: userTestData.userId,
    expiresAt: ExpiresAt.NEVER,
  });

  await queryConnection.end({
    timeout: 3,
  });
}

export function createTestAuthenticator(): {
  authenticator: Authenticator;
  userTestData: UserTestData;
} {
  const userId = randomUUID();
  const organizationId = randomUUID();

  const userAuthContext: UserTestData = {
    userId,
    organizationId,
    organizationName: 'wundergraph',
    email: userId + '@wg.com',
    apiKey: nuid.next(),
    organizationSlug: `slug-${organizationId}`,
  };

  return {
    authenticator: {
      authenticateRouter(headers: Headers): Promise<GraphKeyAuthContext> {
        return Promise.resolve({
          federatedGraphId: 'federated-graph-id',
          organizationId: userAuthContext.organizationId,
        });
      },
      authenticate(headers: Headers): Promise<AuthContext> {
        return Promise.resolve({ ...userAuthContext, isAdmin: true, hasWriteAccess: true });
      },
    },

    userTestData: userAuthContext,
  };
}
