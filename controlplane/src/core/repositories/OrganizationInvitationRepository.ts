import { SQL, and, asc, eq, like, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { alias } from 'drizzle-orm/pg-core';
import { FastifyBaseLogger } from 'fastify';
import * as schema from '../../db/schema.js';
import { organizationInvitations, organizations, users } from '../../db/schema.js';
import { OrganizationDTO, OrganizationInvitationDTO, UserDTO } from '../../types/index.js';
import { OrganizationRepository } from './OrganizationRepository.js';
import { UserRepository } from './UserRepository.js';

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
  }): Promise<OrganizationInvitationDTO[]> {
    const conditions: SQL<unknown>[] = [
      eq(organizationInvitations.organizationId, input.organizationId),
      eq(organizationInvitations.accepted, false),
    ];

    if (input.search) {
      conditions.push(like(users.email, `%${input.search}%`));
    }

    return this.db
      .select({
        userID: users.id,
        email: users.email,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .where(and(...conditions))
      .orderBy(asc(organizationInvitations.createdAt))
      .offset(input.offset ?? 0)
      .limit(input.limit ?? 0)
      .execute();
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
  }): Promise<(Omit<OrganizationDTO, 'billing' | 'subscription'> & { invitedBy: string | undefined })[]> {
    const users1 = alias(users, 'users1');

    const pendingOrgInvites = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
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
      creatorUserId: org.creatorUserId,
      createdAt: org.createdAt.toISOString(),
      invitedBy: org.invitedBy || undefined,
    }));
  }

  public async getPendingOrganizationInvitation(input: {
    organizationID: string;
    userID: string;
  }): Promise<OrganizationInvitationDTO | null> {
    const users1 = alias(users, 'users1');

    const orgMember = await this.db
      .select({
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
    } as OrganizationInvitationDTO;
  }

  public async inviteUser(input: {
    email: string;
    userId: string;
    organizationId: string;
    dbUser: UserDTO | null;
    inviterUserId: string;
  }) {
    await this.db.transaction(async (tx) => {
      const userRepo = new UserRepository(tx);

      if (!input.dbUser) {
        await userRepo.addUser({
          id: input.userId,
          email: input.email,
        });
      }

      await tx
        .insert(organizationInvitations)
        .values({
          userId: input.userId,
          organizationId: input.organizationId,
          accepted: false,
          invitedBy: input.inviterUserId,
        })
        .execute();
    });
  }

  public async acceptInvite(input: { userId: string; organizationId: string }) {
    await this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(this.logger, tx, this.defaultBillingPlanId);
      await tx
        .update(organizationInvitations)
        .set({ accepted: true })
        .where(
          and(
            eq(organizationInvitations.userId, input.userId),
            eq(organizationInvitations.organizationId, input.organizationId),
          ),
        )
        .execute();

      const insertedMember = await orgRepo.addOrganizationMember({
        userID: input.userId,
        organizationID: input.organizationId,
      });

      await orgRepo.addOrganizationMemberRoles({ memberID: insertedMember.id, roles: ['developer'] });
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
