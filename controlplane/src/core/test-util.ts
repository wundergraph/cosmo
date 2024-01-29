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
import { GraphApiJwtPayload, GraphKeyAuthContext } from './services/GraphApiTokenAuthenticator.js';
import { ApiKeyRepository } from './repositories/ApiKeyRepository.js';
import { DefaultNamespace, NamespaceRepository } from './repositories/NamespaceRepository.js';
import { verifyJwt } from './crypto/jwt.js';

export type UserTestData = {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  defaultBillingPlanId?: string;
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
  const orgRepo = new OrganizationRepository(db, userTestData.defaultBillingPlanId);
  const apiKeyRepo = new ApiKeyRepository(db);

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
  });

  await orgRepo.addOrganizationMemberRoles({
    memberID: orgMember.id,
    roles: ['admin'],
  });

  await apiKeyRepo.addAPIKey({
    key: userTestData.apiKey,
    name: 'myAdminKey',
    organizationID: insertedOrg.id,
    userID: userTestData.userId,
    expiresAt: ExpiresAt.NEVER,
    targetIds: [],
  });

  const namespaceRepo = new NamespaceRepository(db, insertedOrg.id);
  const ns = await namespaceRepo.create({
    name: DefaultNamespace,
    createdBy: userTestData.userId,
  });
  if (!ns) {
    throw new Error(`Could not create ${DefaultNamespace} namespace`);
  }

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

  const userAuthContext: UserTestData & AuthContext = {
    auth: 'api_key',
    userId,
    organizationId,
    organizationName: 'wundergraph',
    email: userId + '@wg.com',
    apiKey: nuid.next(),
    organizationSlug: `slug-${organizationId}`,
    hasWriteAccess: true,
    isAdmin: true,
    userDisplayName: userId,
  };

  return {
    authenticator: {
      async authenticateRouter(headers: Headers): Promise<GraphKeyAuthContext> {
        const authorization = headers.get('authorization');
        if (authorization) {
          try {
            const token = authorization.replace(/^bearer\s+/i, '');
            const jwtPayload = await verifyJwt<GraphApiJwtPayload>('secret', token);
            return {
              organizationId: jwtPayload.organization_id,
              federatedGraphId: jwtPayload.federated_graph_id,
            };
          } catch (e) {
            console.error(e);
          }
        }

        return {
          federatedGraphId: 'federated-graph-id',
          organizationId: userAuthContext.organizationId,
        };
      },
      authenticate(headers: Headers): Promise<AuthContext> {
        return Promise.resolve(userAuthContext);
      },
    },

    userTestData: userAuthContext,
  };
}
