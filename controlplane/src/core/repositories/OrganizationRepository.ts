import { ExpiresAt } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { and, asc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import {
  apiKeys,
  organizationMemberRoles,
  organizationWebhooks,
  organizations,
  organizationsMembers,
  users,
} from '../../db/schema.js';
import { APIKeyDTO, OrganizationDTO, OrganizationMemberDTO, WebhooksConfigDTO } from '../../types/index.js';

/**
 * Repository for organization related operations.
 */
export class OrganizationRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  public async isMemberOf(input: { organizationId: string; userId: string }): Promise<boolean> {
    const userOrganizations = await this.db
      .select({
        userId: users.id,
        organizationId: organizations.id,
        slug: organizations.slug,
      })
      .from(organizationsMembers)
      .innerJoin(organizations, eq(organizations.id, input.organizationId))
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .limit(1)
      .where(eq(users.id, input.userId))
      .execute();

    return userOrganizations.length > 0;
  }

  public async bySlug(slug: string): Promise<OrganizationDTO | null> {
    const org = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1)
      .execute();

    if (org.length === 0) {
      return null;
    }

    return org[0];
  }

  public async byId(id: string): Promise<OrganizationDTO | null> {
    const org = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
      })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1)
      .execute();

    if (org.length === 0) {
      return null;
    }

    return org[0];
  }

  public async memberships(input: { userId: string }): Promise<OrganizationDTO[]> {
    const userOrganizations = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        isFreeTrial: organizations.isFreeTrial,
      })
      .from(organizationsMembers)
      .innerJoin(organizations, eq(organizations.id, organizationsMembers.organizationId))
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(eq(users.id, input.userId))
      .execute();

    return userOrganizations.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      isFreeTrial: org.isFreeTrial || false,
    }));
  }

  public async getOrganizationMember(input: {
    organizationID: string;
    userID: string;
  }): Promise<OrganizationMemberDTO | null> {
    const orgMember = await this.db
      .select({
        id: users.id,
        email: users.email,
        acceptedInvite: organizationsMembers.acceptedInvite,
        memberID: organizationsMembers.id,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(and(eq(organizationsMembers.organizationId, input.organizationID), eq(users.id, input.userID)))
      .orderBy(asc(organizationsMembers.createdAt))
      .execute();

    if (orgMember.length === 0) {
      return null;
    }

    const userRoles = await this.getOrganizationMemberRoles({
      organizationID: input.organizationID,
      userID: input.userID,
    });

    return {
      id: orgMember[0].id,
      email: orgMember[0].email,
      roles: userRoles,
      acceptedInvite: orgMember[0].acceptedInvite,
    } as OrganizationMemberDTO;
  }

  public async getMembers(input: { organizationID: string }): Promise<OrganizationMemberDTO[]> {
    const orgMembers = await this.db
      .select({
        id: users.id,
        email: users.email,
        acceptedInvite: organizationsMembers.acceptedInvite,
        memberID: organizationsMembers.id,
      })
      .from(organizationsMembers)
      .innerJoin(users, eq(users.id, organizationsMembers.userId))
      .where(eq(organizationsMembers.organizationId, input.organizationID))
      .orderBy(asc(organizationsMembers.createdAt))
      .execute();

    const members: OrganizationMemberDTO[] = [];

    for (const member of orgMembers) {
      const roles = await this.db
        .select({
          role: organizationMemberRoles.role,
        })
        .from(organizationMemberRoles)
        .where(eq(organizationMemberRoles.organizationMemberId, member.memberID))
        .execute();
      members.push({
        id: member.id,
        email: member.email,
        roles: roles.map((role) => role.role),
        acceptedInvite: member.acceptedInvite,
      } as OrganizationMemberDTO);
    }
    return members;
  }

  public async createOrganization(input: {
    organizationID?: string;
    organizationName: string;
    organizationSlug: string;
    ownerID: string;
    isFreeTrial?: boolean;
  }): Promise<OrganizationDTO> {
    const insertedOrg = await this.db
      .insert(organizations)
      .values({
        id: input.organizationID,
        name: input.organizationName,
        slug: input.organizationSlug,
        createdBy: input.ownerID,
        isFreeTrial: input.isFreeTrial,
      })
      .returning()
      .execute();

    return {
      id: insertedOrg[0].id,
      name: insertedOrg[0].name,
      slug: insertedOrg[0].slug,
    };
  }

  public async addOrganizationMember(input: { userID: string; organizationID: string; acceptedInvite: boolean }) {
    const insertedMember = await this.db
      .insert(organizationsMembers)
      .values({
        userId: input.userID,
        organizationId: input.organizationID,
        acceptedInvite: input.acceptedInvite,
      })
      .returning()
      .execute();
    return insertedMember[0];
  }

  public async addOrganizationMemberRoles(input: { memberID: string; roles: ('admin' | 'member')[] }) {
    const values: {
      organizationMemberId: string;
      role: 'admin' | 'member';
    }[] = [];

    for (const role of input.roles) {
      values.push({
        organizationMemberId: input.memberID,
        role,
      });
    }

    await this.db.insert(organizationMemberRoles).values(values).execute();
  }

  public async removeOrganizationMember(input: { userID: string; organizationID: string }) {
    await this.db
      .delete(organizationsMembers)
      .where(
        and(
          eq(organizationsMembers.organizationId, input.organizationID),
          eq(organizationsMembers.userId, input.userID),
        ),
      )
      .execute();
  }

  public async getOrganizationMemberRoles(input: {
    userID: string;
    organizationID: string;
  }): Promise<('admin' | 'member')[]> {
    const userRoles = await this.db
      .select({
        role: organizationMemberRoles.role,
      })
      .from(organizationMemberRoles)
      .innerJoin(organizationsMembers, eq(organizationsMembers.id, organizationMemberRoles.organizationMemberId))
      .where(
        and(
          eq(organizationsMembers.userId, input.userID),
          eq(organizationsMembers.organizationId, input.organizationID),
        ),
      )
      .execute();

    return userRoles.map((role) => role.role);
  }

  public async addAPIKey(input: {
    key: string;
    name: string;
    organizationID: string;
    userID: string;
    expiresAt: ExpiresAt;
  }) {
    let expiresAtDate: Date | undefined;
    const present = new Date();
    switch (input.expiresAt) {
      case ExpiresAt.NEVER: {
        expiresAtDate = undefined;
        break;
      }
      case ExpiresAt.THIRTY_DAYS: {
        expiresAtDate = new Date(new Date().setDate(present.getDate() + 30));
        break;
      }
      case ExpiresAt.SIX_MONTHS: {
        expiresAtDate = new Date(new Date().setMonth(present.getMonth() + 6));
        break;
      }
      case ExpiresAt.ONE_YEAR: {
        expiresAtDate = new Date(new Date().setFullYear(present.getFullYear() + 1));
        break;
      }
      default: {
        throw new Error('ExpiresAt value does not exist');
      }
    }

    await this.db
      .insert(apiKeys)
      .values({
        key: input.key,
        name: input.name,
        organizationId: input.organizationID,
        userId: input.userID,
        expiresAt: expiresAtDate,
      })
      .execute();
  }

  public async removeAPIKey(input: { name: string; organizationID: string }) {
    await this.db
      .delete(apiKeys)
      .where(and(eq(apiKeys.organizationId, input.organizationID), eq(apiKeys.name, input.name)))
      .execute();
  }

  public async getAPIKeyByName(input: { organizationID: string; name: string }): Promise<APIKeyDTO | undefined> {
    const key = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdBy: users.email,
        creatorUserID: users.id,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(and(eq(apiKeys.organizationId, input.organizationID), eq(apiKeys.name, input.name)))
      .execute();

    if (key.length === 0) {
      return undefined;
    }

    return {
      id: key[0].id,
      name: key[0].name,
      createdAt: key[0].createdAt.toISOString(),
      lastUsedAt: key[0].lastUsedAt?.toISOString() ?? '',
      expiresAt: key[0].expiresAt?.toISOString() ?? '',
      createdBy: key[0].createdBy,
      creatorUserID: key[0].creatorUserID,
    } as APIKeyDTO;
  }

  public async getAPIKeys(input: { organizationID: string }): Promise<APIKeyDTO[]> {
    const keys = await this.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdBy: users.email,
        creatorUserID: users.id,
      })
      .from(apiKeys)
      .innerJoin(users, eq(users.id, apiKeys.userId))
      .where(eq(apiKeys.organizationId, input.organizationID))
      .orderBy(asc(apiKeys.createdAt))
      .execute();

    return keys.map(
      (key) =>
        ({
          id: key.id,
          name: key.name,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? '',
          expiresAt: key.expiresAt?.toISOString() ?? '',
          createdBy: key.createdBy,
          creatorUserID: key.creatorUserID,
        } as APIKeyDTO),
    );
  }

  public async saveWebhooksConfig(input: { organizationId: string; endpoint: string; key: string; events: string[] }) {
    await this.db
      .insert(organizationWebhooks)
      .values({
        ...input,
      })
      .onConflictDoUpdate({
        target: organizationWebhooks.organizationId,
        set: {
          ...input,
        },
      });
  }

  public async getWebhooksConfig(organizationId: string): Promise<WebhooksConfigDTO> {
    const res = await this.db.query.organizationWebhooks.findFirst({
      where: eq(organizationWebhooks.organizationId, organizationId),
    });

    return {
      endpoint: res?.endpoint ?? '',
      events: res?.events ?? [],
    };
  }
}
