import { SQL, and, asc, eq, like, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { alias } from 'drizzle-orm/pg-core';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { organizationInvitations, organizations, users } from '../../db/schema.js';
import { OrganizationDTO, OrganizationInvitationDTO, UserDTO } from '../../types/index.js';
import { OrganizationRepository } from './OrganizationRepository.js';
import { UserRepository } from './UserRepository.js';
import { OrganizationGroupRepository } from './OrganizationGroupRepository.js';

export class OrganizationInvitationRepository {
  constructor(
    private logger: FastifyBaseLogger,
    private db: PostgresJsDatabase<typeof schema>,
    private defaultBillingPlanId?: string,
  ) {}

  // returns the members who have pending invites to the provided organization.
  public getPendingInvitationsOfOrganization(input: {
    organizationId: string;
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<Omit<OrganizationInvitationDTO, 'groups'>[]> {
    const conditions: SQL<unknown>[] = [
      eq(organizationInvitations.organizationId, input.organizationId),
      eq(organizationInvitations.accepted, false),
    ];

    if (input.search) {
      conditions.push(like(users.email, `%${input.search}%`));
    }

    const dbQuery = this.db
      .select({
        userID: users.id,
        email: users.email,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .where(and(...conditions))
      .orderBy(asc(organizationInvitations.createdAt));

    if (input.limit) {
      dbQuery.limit(input.limit);
    }

    if (input.offset) {
      dbQuery.offset(input.offset);
    }

    return dbQuery.execute();
  }

  public async pendingInvitationsCount(organizationId: string, search?: string): Promise<number> {
    const count = await this.db
      .select({
        count: sql<number>`cast(count(${organizationInvitations.id}) as int)`,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .where(
        and(
          eq(organizationInvitations.organizationId, organizationId),
          eq(organizationInvitations.accepted, false),
          search ? like(users.email, `%${search}%`) : undefined,
        ),
      )
      .groupBy(organizationInvitations.organizationId)
      .execute();

    return count[0]?.count || 0;
  }

  // returns the organizations to which the user has a pending invite.
  public async getPendingInvitationsOfUser(input: {
    userId: string;
  }): Promise<(Omit<OrganizationDTO, 'billing' | 'subscription' | 'rbac'> & { invitedBy: string | undefined })[]> {
    const users1 = alias(users, 'users1');

    const pendingOrgInvites = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
        kcGroupId: organizations.kcGroupId,
        invitedBy: users1.email,
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .leftJoin(users1, eq(users1.id, organizationInvitations.invitedBy))
      .where(and(eq(users.id, input.userId), eq(organizationInvitations.accepted, false)))
      .execute();

    return pendingOrgInvites.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      groups: [],
      creatorUserId: org.creatorUserId || undefined,
      createdAt: org.createdAt.toISOString(),
      invitedBy: org.invitedBy || undefined,
      kcGroupId: org.kcGroupId || undefined,
    }));
  }

  public async getPendingOrganizationInvitation(input: {
    organizationID: string;
    userID: string;
  }): Promise<OrganizationInvitationDTO | null> {
    const users1 = alias(users, 'users1');

    const orgMember = await this.db
      .select({
        invitationId: schema.organizationInvitations.id,
        userID: users.id,
        email: users.email,
        invitedBy: users1.email,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .leftJoin(users1, eq(users1.id, organizationInvitations.invitedBy))
      .where(
        and(
          eq(organizationInvitations.organizationId, input.organizationID),
          eq(users.id, input.userID),
          eq(organizationInvitations.accepted, false),
        ),
      )
      .orderBy(asc(organizationInvitations.createdAt))
      .execute();

    if (orgMember.length === 0) {
      return null;
    }

    return {
      userID: orgMember[0].userID,
      email: orgMember[0].email,
      invitedBy: orgMember[0].invitedBy || undefined,
      groups: await this.getPendingInvitationGroups(orgMember[0].invitationId),
    } as OrganizationInvitationDTO;
  }

  private getPendingInvitationGroups(invitationId: string): Promise<{ groupId: string; kcGroupId: string | null }[]> {
    return this.db
      .select({
        groupId: schema.organizationInvitationGroups.groupId,
        kcGroupId: schema.organizationGroups.kcGroupId,
      })
      .from(schema.organizationInvitationGroups)
      .innerJoin(
        schema.organizationGroups,
        eq(schema.organizationGroups.id, schema.organizationInvitationGroups.groupId),
      )
      .where(eq(schema.organizationInvitationGroups.invitationId, invitationId));
  }

  public async inviteUser(input: {
    email: string;
    userId: string;
    organizationId: string;
    dbUser: UserDTO | null;
    inviterUserId: string;
    groups: string[];
  }) {
    await this.db.transaction(async (tx) => {
      const userRepo = new UserRepository(this.logger, tx);

      if (!input.dbUser) {
        await userRepo.addUser({
          id: input.userId,
          email: input.email,
        });
      }

      const inserted = await tx
        .insert(organizationInvitations)
        .values({
          userId: input.userId,
          organizationId: input.organizationId,
          accepted: false,
          invitedBy: input.inviterUserId,
        })
        .returning()
        .execute();

      if (inserted.length === 0) {
        return;
      }

      await tx
        .insert(schema.organizationInvitationGroups)
        .values(
          input.groups.map((groupId) => ({
            invitationId: inserted[0].id,
            groupId,
          })),
        )
        .execute();
    });
  }

  public async acceptInvite(input: { userId: string; organizationId: string }) {
    await this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(this.logger, tx, this.defaultBillingPlanId);
      const invitation = await tx
        .update(organizationInvitations)
        .set({ accepted: true })
        .where(
          and(
            eq(organizationInvitations.userId, input.userId),
            eq(organizationInvitations.organizationId, input.organizationId),
            eq(organizationInvitations.accepted, false),
          ),
        )
        .returning()
        .execute();

      if (invitation.length === 0) {
        return;
      }

      const insertedMember = await orgRepo.addOrganizationMember({
        userID: input.userId,
        organizationID: input.organizationId,
      });

      const invitationGroups = await this.getPendingInvitationGroups(invitation[0].id);
      if (invitationGroups.length === 0) {
        return;
      }

      const orgGroupRepo = new OrganizationGroupRepository(tx);
      for (const group of invitationGroups) {
        await orgGroupRepo.addUserToGroup({
          organizationMemberId: insertedMember.id,
          groupId: group.groupId,
        });
      }
    });
  }

  public async removeInvite(input: { userId: string; organizationId: string }) {
    await this.db
      .delete(organizationInvitations)
      .where(
        and(
          eq(organizationInvitations.organizationId, input.organizationId),
          eq(organizationInvitations.userId, input.userId),
          eq(organizationInvitations.accepted, false),
        ),
      )
      .execute();
  }
}
