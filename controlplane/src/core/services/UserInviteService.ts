import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { FastifyBaseLogger } from 'fastify';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { sql } from 'drizzle-orm';
import { OrganizationRepository } from '../repositories/OrganizationRepository.js';
import * as schema from '../../db/schema.js';
import { PublicError } from '../errors/errors.js';
import { OrganizationGroupRepository } from '../repositories/OrganizationGroupRepository.js';
import { OrganizationInvitationRepository } from '../repositories/OrganizationInvitationRepository.js';
import { UserRepository } from '../repositories/UserRepository.js';
import { OrganizationInvitationDTO, UserDTO } from '../../types/index.js';
import Keycloak from './Keycloak.js';
import Mailer from './Mailer.js';

export class UserInviteService {
  private readonly db: PostgresJsDatabase<typeof schema>;
  private readonly logger: FastifyBaseLogger;
  private readonly keycloakRealm: string | undefined;
  private readonly keycloak: Keycloak;
  private readonly mailer: Mailer | undefined;

  constructor(input: {
    db: PostgresJsDatabase<typeof schema>;
    logger: FastifyBaseLogger;
    keycloakRealm: string | undefined;
    keycloak: Keycloak;
    mailer: Mailer | undefined;
  }) {
    this.db = input.db;
    this.logger = input.logger;
    this.keycloakRealm = input.keycloakRealm;
    this.keycloak = input.keycloak;
    this.mailer = input.mailer;
  }

  inviteUser(input: {
    organizationId: string;
    inviterUserId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    password?: string;
    groups?: string[];
  }) {
    return this.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(this.logger, tx);
      const userRepo = new UserRepository(this.logger, tx);
      const orgInvitationRepo = new OrganizationInvitationRepository(this.logger, tx);

      // Acquire a lock so we don't create multiple invitations for the same user
      const lockKey = `invite:${input.organizationId}:${input.email}`;
      const advisoryLockRows = await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtext(${lockKey})) as acquired`,
      );

      if (!advisoryLockRows?.[0]?.acquired) {
        // Another request already acquired the lock for this invitation
        throw new PublicError(EnumStatusCode.ERR, 'Slow down');
      }

      // Retrieve the organization by the provided organization ID
      const organization = await orgRepo.byId(input.organizationId);
      if (!organization?.kcGroupId) {
        // An organization doesn't exist with the provided organization ID
        throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, 'Organization not found');
      }

      // Determine whether the organization can invite new members
      const memberCount = await orgRepo.memberCount(input.organizationId);
      const usersFeature = await orgRepo.getFeature({
        organizationId: input.organizationId,
        featureId: 'users',
      });

      const limit = usersFeature?.limit === -1 ? undefined : usersFeature?.limit;
      if (limit && memberCount >= limit) {
        // The organization has reached the member limit
        throw new PublicError(EnumStatusCode.ERR_LIMIT_REACHED, `The user limit for this organization has been reached`);
      }

      // Check whether the organization member already exists
      const orgMember = await orgRepo.getOrganizationMemberByEmail({
        organizationID: input.organizationId,
        userEmail: input.email,
      });

      if (orgMember) {
        throw new PublicError(EnumStatusCode.ERR_ALREADY_EXISTS, 'User is already a part of the organization.');
      }

      // Retrieve the user from Keycloak
      await this.keycloak.authenticateClient();
      const keycloakUser = await this.keycloak.findUserByEmail({
        email: input.email,
        realm: this.keycloakRealm,
      });

      let keycloakUserId: string;
      let user: UserDTO | null = null;
      if (keycloakUser?.id) {
        // The user already exists in Keycloak
        keycloakUserId = keycloakUser.id!;
        user = await userRepo.byId(keycloakUserId);
        if (!user) {
          // Make sure the user exists in the database
          await userRepo.addUser({ id: keycloakUserId, email: input.email });
        }
      } else {
        // The user doesn't exist in Keycloak
        keycloakUserId = await this.keycloak.addKeycloakUser({
          realm: this.keycloakRealm,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          isPasswordTemp: true,
        });

        await userRepo.addUser({ id: keycloakUserId, email: input.email });
      }

      // Ensure that the user exists in the database
      if (!user) {
        user = await userRepo.byId(keycloakUserId);
      }

      if (!user) {
        throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, 'User not found');
      }

      // Check whether an invitation already exists for the user
      const pendingInv = await orgInvitationRepo.getPendingOrganizationInvitation({
        organizationID: organization.id,
        userID: keycloakUserId,
      });

      if (pendingInv) {
        // Resend invitation
        await this.#sendInvitation({
          orgRepo,
          orgInvitationRepo,
          pendingInvitation: pendingInv,
          organizationId: organization.id,
          organizationName: organization.name,
          invitedBy: pendingInv.invitedBy,
          userId: keycloakUserId,
          receiverEmail: input.email,
        });

        return keycloakUserId;
      }

      // Validate that the provided groups (if any) are valid for the organization
      const groups: string[] = [];
      if (input.groups) {
        const orgGroupRepo = new OrganizationGroupRepository(tx);
        for (const groupId of input.groups) {
          const group = await orgGroupRepo.byId({
            organizationId: input.organizationId,
            groupId,
          });

          if (!group) {
            throw new PublicError(EnumStatusCode.ERR_NOT_FOUND, 'Group not found');
          }

          groups.push(group.groupId);
        }
      }

      if (input.groups && groups.length === 0) {
        // No valid groups were provided
        throw new PublicError(EnumStatusCode.ERR, 'No group was provided');
      }

      // Create invitation
      await orgInvitationRepo.inviteUser({
        email: input.email,
        userId: keycloakUserId,
        organizationId: organization.id,
        dbUser: user,
        inviterUserId: input.inviterUserId,
        groups,
      });

      await this.#sendInvitation({
        orgRepo,
        orgInvitationRepo,
        organizationId: organization.id,
        organizationName: organization.name,
        invitedBy: input.inviterUserId,
        userId: keycloakUserId,
        receiverEmail: input.email,
      });

      // Done
      return keycloakUserId;
    });
  }

  async #sendInvitation({
    orgRepo,
    orgInvitationRepo,
    pendingInvitation,
    organizationId,
    organizationName,
    invitedBy,
    userId,
    receiverEmail,
  }: {
    orgRepo: OrganizationRepository;
    orgInvitationRepo: OrganizationInvitationRepository;
    pendingInvitation?: OrganizationInvitationDTO;
    organizationId: string;
    organizationName: string;
    invitedBy: string | undefined;
    userId: string;
    receiverEmail: string;
  }) {
    const memberships = await orgRepo.memberships({ userId });
    if (memberships.length === 0) {
      // If the user memberships are empty, that means the user has not logged in until now,
      // so we send the user a mail form Keycloak
      await this.keycloak.executeActionsEmail({
        realm: this.keycloakRealm,
        userID: userId,
        redirectURI: `${process.env.WEB_BASE_URL}/login?redirectURL=${process.env.WEB_BASE_URL}/account/invitations`,
      });
    } else {
      // The user has already logged in, so we send our custom org invitation email
      if (!this.mailer) {
        return;
      }

      if (pendingInvitation?.lastSentAt && pendingInvitation.lastSentAt.getTime() + 1000 * 60 * 30 > Date.now()) {
        // We are not sending the invitation more than once every 30 minutes
        return;
      }

      await this.mailer.sendInviteEmail({
        inviteLink: `${process.env.WEB_BASE_URL}/account/invitations`,
        organizationName,
        receiverEmail,
        invitedBy,
      });
    }

    await orgInvitationRepo.updateLastSentToNow({ organizationId, userId });
  }
}
