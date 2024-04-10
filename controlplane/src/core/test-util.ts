import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import nuid from 'nuid';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { pino } from 'pino';
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
  const sql = postgres('postgresql://postgres:changeme@localhost:5432/postgres', { max: 1 });
  await sql`DROP DATABASE "${sql.unsafe(dbname)}"`;
  await sql.end({ timeout: 1 });
}

export function genID(prefix = 'prefix') {
  return prefix + '-' + nuid.next();
}

export function genUniqueLabel(prefix = 'prefix'): Label {
  return { key: prefix + '-' + genID(), value: genID() };
}

export async function seedTest(queryConnection: postgres.Sql, userTestData: UserTestData, createScimKey?: boolean) {
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const userRepo = new UserRepository(db);
  const orgRepo = new OrganizationRepository(pino(), db, userTestData.defaultBillingPlanId);
  const apiKeyRepo = new ApiKeyRepository(db);

  const user = await userRepo.byEmail(userTestData.email);
  if (user) {
    return;
  }

  await userRepo.addUser({
    id: userTestData.userId,
    email: userTestData.email,
  });

  let org = await orgRepo.byId(userTestData.organizationId);

  if (!org) {
    org = await orgRepo.createOrganization({
      organizationID: userTestData.organizationId,
      organizationName: userTestData.organizationName,
      organizationSlug: userTestData.organizationSlug,
      ownerID: userTestData.userId,
    });
  }

  const orgMember = await orgRepo.addOrganizationMember({
    organizationID: org.id,
    userID: userTestData.userId,
  });

  await orgRepo.addOrganizationMemberRoles({
    memberID: orgMember.id,
    roles: ['admin'],
  });

  await apiKeyRepo.addAPIKey({
    key: userTestData.apiKey,
    name: userTestData.email,
    organizationID: org.id,
    userID: userTestData.userId,
    expiresAt: ExpiresAt.NEVER,
    targetIds: [],
    permissions: createScimKey ? ['scim'] : [],
  });

  const namespaceRepo = new NamespaceRepository(db, org.id);
  const ns = await namespaceRepo.byName(DefaultNamespace);
  if (!ns) {
    const ns = await namespaceRepo.create({
      name: DefaultNamespace,
      createdBy: userTestData.userId,
    });
    if (!ns) {
      throw new Error(`Could not create ${DefaultNamespace} namespace`);
    }
  }
}

export function createTestContext(
  organizationName = 'wundergraph',
  organizationId = randomUUID(),
): UserTestData & AuthContext {
  const userId = randomUUID();

  return {
    auth: 'api_key',
    userId,
    organizationId,
    organizationName,
    email: userId + '@wg.com',
    apiKey: nuid.next(),
    organizationSlug: `slug-${organizationId}`,
    hasWriteAccess: true,
    isAdmin: true,
    userDisplayName: userId,
  };
}

export interface TestAuthenticator extends Authenticator {
  changeUser(user: TestUser): void;
}

export enum TestUser {
  adminAliceCompanyA = 'adminAliceCompanyA',
  adminBobCompanyA = 'adminBobCompanyA',
  adminJimCompanyB = 'adminJimCompanyB',
}

export type DefaultTestAuthenticatorOptions = {
  [TestUser.adminAliceCompanyA]: UserTestData & AuthContext;
};

export type TestAuthenticatorOptions = {
  -readonly [key in keyof typeof TestUser]?: UserTestData & AuthContext;
} & DefaultTestAuthenticatorOptions;

export function createTestAuthenticator(users: TestAuthenticatorOptions): TestAuthenticator {
  let activeContext: UserTestData & AuthContext = users.adminAliceCompanyA;

  return {
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

      throw new Error('No authorization header found');
    },
    authenticate(headers: Headers): Promise<AuthContext> {
      if (!activeContext) {
        throw new Error('No active context found');
      }
      return Promise.resolve(activeContext);
    },
    changeUser(user: TestUser) {
      if (!(user in users)) {
        throw new Error('User not found');
      }
      activeContext = users[user]!;
    },
  };
}
