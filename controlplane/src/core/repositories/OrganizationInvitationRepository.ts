import { and, asc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { organizationInvitations, organizations, users } from '../../db/schema.js';
import { OrganizationDTO, OrganizationInvitationDTO, UserDTO } from '../../types/index.js';
import { OrganizationRepository } from './OrganizationRepository.js';
import { UserRepository } from './UserRepository.js';

export class OrganizationInvitationRepository {
  constructor(private db: PostgresJsDatabase<typeof schema>) {}

  // returns the members who have pending invites to the provided organization.
  public async getPendingInvitationsOfOrganization(input: {
    organizationId: string;
  }): Promise<OrganizationInvitationDTO[]> {
    const pendingInvites = await this.db
      .select({
        userID: users.id,
        email: users.email,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .where(
        and(
          eq(organizationInvitations.organizationId, input.organizationId),
          eq(organizationInvitations.accepted, false),
        ),
      )
      .orderBy(asc(organizationInvitations.createdAt))
      .execute();

    return pendingInvites;
  }

  // returns the organizations to which the user has a pending invite.
  public async getPendingInvitationsOfUser(input: { userId: string }): Promise<OrganizationDTO[]> {
    const pendingOrgInvites = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        creatorUserId: organizations.createdBy,
        createdAt: organizations.createdAt,
      })
      .from(organizationInvitations)
      .innerJoin(organizations, eq(organizations.id, organizationInvitations.organizationId))
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
      .where(and(eq(users.id, input.userId), eq(organizationInvitations.accepted, false)))
      .execute();

    const userInvitations = pendingOrgInvites.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      creatorUserId: org.creatorUserId,
      createdAt: org.createdAt.toISOString(),
    }));

    return userInvitations;
  }

  public async getPendingOrganizationInvitation(input: {
    organizationID: string;
    userID: string;
  }): Promise<OrganizationInvitationDTO | null> {
    const orgMember = await this.db
      .select({
        userID: users.id,
        email: users.email,
      })
      .from(organizationInvitations)
      .innerJoin(users, eq(users.id, organizationInvitations.userId))
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
    } as OrganizationInvitationDTO;
  }

  public async inviteUser(input: { email: string; userId: string; organizationId: string; dbUser: UserDTO | null }) {
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
        })
        .execute();
    });
  }

  public async acceptInvite(input: { userId: string; organizationId: string }) {
    await this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(tx);
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
