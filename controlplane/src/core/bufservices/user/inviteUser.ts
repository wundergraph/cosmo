import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { InviteUserRequest, InviteUserResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationInvitationRepository } from '../../repositories/OrganizationInvitationRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function inviteUser(
  opts: RouterOptions,
  req: InviteUserRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<InviteUserResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<InviteUserResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const userRepo = new UserRepository(logger, opts.db);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const organization = await orgRepo.byId(authContext.organizationId);
    if (!organization) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const memberCount = await orgRepo.memberCount(authContext.organizationId);
    const usersFeature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'users',
    });

    const limit = usersFeature?.limit === -1 ? undefined : usersFeature?.limit;

    if (limit && memberCount >= limit) {
      return {
        response: {
          code: EnumStatusCode.ERR_LIMIT_REACHED,
          details: `The user limit for this organization has been reached`,
        },
      };
    }

    await opts.keycloakClient.authenticateClient();

    const keycloakUser = await opts.keycloakClient.client.users.find({
      max: 1,
      email: req.email,
      realm: opts.keycloakRealm,
      exact: true,
    });

    let keycloakUserID;

    if (keycloakUser.length === 0) {
      keycloakUserID = await opts.keycloakClient.addKeycloakUser({
        email: req.email,
        isPasswordTemp: true,
        realm: opts.keycloakRealm,
      });
    } else {
      keycloakUserID = keycloakUser[0].id;
    }

    const user = await userRepo.byId(keycloakUserID!);

    const groups: string[] = [];
    for (const groupId of req.groups) {
      const group = await orgGroupRepo.byId({
        organizationId: authContext.organizationId,
        groupId,
      });

      if (!group) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: 'Group not found',
          },
        };
      }

      groups.push(group.groupId);
    }

    if (user) {
      const orgMember = await orgRepo.getOrganizationMember({
        organizationID: authContext.organizationId,
        userID: user.id,
      });
      if (orgMember) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `${req.email} is already a member of this organization`,
          },
        };
      }

      const orgInvitation = await orgInvitationRepo.getPendingOrganizationInvitation({
        organizationID: authContext.organizationId,
        userID: user.id,
      });
      if (orgInvitation) {
        const userMemberships = await orgRepo.memberships({ userId: user.id });
        // if the user memberships are empty, that means the user has not logged in till now,
        // so we send the user a mail form keycloak
        if (userMemberships.length === 0) {
          await opts.keycloakClient.executeActionsEmail({
            userID: user.id,
            redirectURI: `${process.env.WEB_BASE_URL}/login?redirectURL=${process.env.WEB_BASE_URL}/account/invitations`,
            realm: opts.keycloakRealm,
          });
        } else {
          // the user has already logged in, so we send our custom org invitation email
          // eslint-disable-next-line no-lonely-if
          if (opts.mailerClient) {
            await opts.mailerClient.sendInviteEmail({
              inviteLink: `${process.env.WEB_BASE_URL}/account/invitations`,
              organizationName: organization.name,
              receiverEmail: req.email,
              invitedBy: orgInvitation.invitedBy,
            });
          }
        }

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: organization.slug,
          auditAction: 'organization_invitation.created',
          action: 'created',
          actorId: authContext.userId,
          auditableDisplayName: req.email,
          auditableType: 'user',
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });

        return {
          response: {
            code: EnumStatusCode.OK,
            details: 'Invited member successfully.',
          },
        };
      }
    }

    // We don't need the group when re-inviting a member
    if (groups.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'No group was provided',
        },
      };
    }

    const userMemberships = await orgRepo.memberships({ userId: keycloakUserID! });
    // to verify if the user is a new user or not, we check the memberships of the user
    if (userMemberships.length > 0) {
      if (opts.mailerClient) {
        const inviter = await userRepo.byId(authContext.userId);
        await opts.mailerClient.sendInviteEmail({
          inviteLink: `${process.env.WEB_BASE_URL}/account/invitations`,
          organizationName: organization.name,
          receiverEmail: req.email,
          invitedBy: inviter?.email,
        });
      }
    } else {
      await opts.keycloakClient.executeActionsEmail({
        userID: keycloakUserID!,
        redirectURI: `${process.env.WEB_BASE_URL}/login?redirectURL=${process.env.WEB_BASE_URL}/account/invitations`,
        realm: opts.keycloakRealm,
      });
    }

    // TODO: rate limit this
    await orgInvitationRepo.inviteUser({
      email: req.email,
      userId: keycloakUserID!,
      organizationId: authContext.organizationId,
      dbUser: user,
      inviterUserId: authContext.userId,
      groups,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: organization.slug,
      auditAction: 'organization_invitation.created',
      action: 'created',
      actorId: authContext.userId,
      auditableDisplayName: req.email,
      auditableType: 'user',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
        details: 'Invited member successfully.',
      },
    };
  });
}
