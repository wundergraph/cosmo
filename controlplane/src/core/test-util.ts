import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import nuid from 'nuid';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { pino } from 'pino';
import { AuthContext, Label, OrganizationGroupDTO } from '../types/index.js';
import * as schema from '../db/schema.js';
import { OrganizationRole } from '../db/models.js';
import { organizationRoleEnum } from '../db/schema.js';
import { Authenticator } from './services/Authentication.js';
import { UserRepository } from './repositories/UserRepository.js';
import { OrganizationRepository } from './repositories/OrganizationRepository.js';
import { GraphApiJwtPayload, GraphKeyAuthContext } from './services/GraphApiTokenAuthenticator.js';
import { ApiKeyRepository } from './repositories/ApiKeyRepository.js';
import { DefaultNamespace, NamespaceRepository } from './repositories/NamespaceRepository.js';
import { verifyJwt } from './crypto/jwt.js';
import { OrganizationGroupRepository } from './repositories/OrganizationGroupRepository.js';
import { RBACEvaluator } from './services/RBACEvaluator.js';

export type UserTestData = {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  defaultBillingPlanId?: string;
  email: string;
  apiKey: string;
  roles: OrganizationRole[];
};

export const defaultGroupDescription: Record<string, string> = {
  admin: 'Grants administrative access for the organization.',
  developer: 'Grants developer access for the organization.',
  viewer: 'Grants readonly access for the organization.',
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

export async function seedTest(
  queryConnection: postgres.Sql,
  userTestData: UserTestData,
  createScimKey?: boolean,
  kcRootGroupId?: string,
  kcGroups?: { id: string; name: string }[],
) {
  const db = drizzle(queryConnection, { schema: { ...schema } });

  const userRepo = new UserRepository(pino(), db);
  const orgRepo = new OrganizationRepository(pino(), db, userTestData.defaultBillingPlanId);
  const orgGroupRepo = new OrganizationGroupRepository(db);
  const apiKeyRepo = new ApiKeyRepository(db);

  const user = await userRepo.byEmail(userTestData.email);
  if (user) {
    return;
  }

  await userRepo.addUser({ id: userTestData.userId, email: userTestData.email });

  let org = await orgRepo.byId(userTestData.organizationId);
  if (!org) {
    org = await orgRepo.createOrganization({
      organizationID: userTestData.organizationId,
      organizationName: userTestData.organizationName,
      organizationSlug: userTestData.organizationSlug,
      ownerID: userTestData.userId,
      kcGroupId: kcRootGroupId,
    });

    for (const groupName of ['admin', 'developer', 'viewer']) {
      const createdGroup = await orgGroupRepo.create({
        organizationId: org.id,
        name: groupName,
        description: defaultGroupDescription[groupName] ?? '',
        builtin: groupName === 'admin',
        kcGroupId: kcGroups?.find((g) => g.name === groupName)?.id || null,
      });

      const roleName = `organization-${groupName}` as OrganizationRole;
      if (organizationRoleEnum.enumValues.includes(roleName)) {
        await orgGroupRepo.updateGroup({
          organizationId: org.id,
          groupId: createdGroup.groupId,
          rules: [
            {
              role: roleName,
              namespaces: [],
              resources: [],
            },
          ],
        });
      }
    }
  }

  const orgMember = await orgRepo.addOrganizationMember({
    organizationID: org.id,
    userID: userTestData.userId,
  });

  const userGroups = userTestData.roles.map((group) => group.split('-').splice(1).join('-'));

  for (const groupName of userGroups) {
    const orgGroup = await orgGroupRepo.byName({
      organizationId: org.id,
      name: groupName,
    });

    if (!orgGroup) {
      continue;
    }

    await orgGroupRepo.addUserToGroup({
      organizationMemberId: orgMember.id,
      groupId: orgGroup.groupId,
    });
  }

  if (userGroups.length > 0) {
    const orgGroup = await orgGroupRepo.byName({
      organizationId: org.id,
      name: userGroups[0],
    });

    if (orgGroup) {
      await apiKeyRepo.addAPIKey({
        key: userTestData.apiKey,
        name: userTestData.email,
        organizationID: org.id,
        userID: userTestData.userId,
        expiresAt: ExpiresAt.NEVER,
        groupId: orgGroup.groupId,
        permissions: createScimKey ? ['scim'] : [],
      });
    }
  }

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

export function createTestRBACEvaluator(...groups: OrganizationGroupDTO[]) {
  return new RBACEvaluator(groups);
}

export function createAPIKeyTestRBACEvaluator(...groups: OrganizationGroupDTO[]) {
  return new RBACEvaluator(groups, undefined, true);
}

export function createTestGroup(
  ...rules: { role: OrganizationRole | string; namespaces?: string[]; resources?: string[] }[]
): OrganizationGroupDTO {
  return {
    groupId: randomUUID(),
    name: genID('group'),
    description: '',
    kcGroupId: randomUUID(),
    membersCount: 0,
    apiKeysCount: 0,
    builtin: false,
    rules: rules.map((r) => ({
      role: r.role as OrganizationRole,
      namespaces: r.namespaces ?? [],
      resources: r.resources ?? [],
    })),
  } satisfies OrganizationGroupDTO;
}

export function createTestContext(
  organizationName = 'wundergraph',
  organizationId = randomUUID(),
  groups: OrganizationRole[] = ['organization-admin'],
  organizationDeactivated = false,
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
    organizationDeactivated,
    userDisplayName: userId,
    roles: groups,
    rbac: createTestRBACEvaluator(...groups.map((g) => createTestGroup({ role: g }))),
  };
}

export interface TestAuthenticator extends Authenticator {
  changeUser(user: TestUser): void;
  changeUserWithSuppliedContext(userContext: UserTestData & AuthContext): void;
}

export enum TestUser {
  adminAliceCompanyA = 'adminAliceCompanyA',
  adminBobCompanyA = 'adminBobCompanyA',
  devJoeCompanyA = 'devJoeCompanyA',
  keyManagerSmithCompanyA = 'keyManagerSmithCompanyA',
  viewerTimCompanyA = 'viewerTimCompanyA',
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
    changeUserWithSuppliedContext(userContext: UserTestData & AuthContext) {
      activeContext = userContext;
    },
  };
}
