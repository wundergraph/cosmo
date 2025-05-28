import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RemoveInvitationRequest,
  RemoveInvitationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationInvitationRepository } from '../../repositories/OrganizationInvitationRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function removeInvitation(
  opts: RouterOptions,
  req: RemoveInvitationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RemoveInvitationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RemoveInvitationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const userRepo = new UserRepository(logger, opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    await opts.keycloakClient.authenticateClient();

    const keycloakUser = await opts.keycloakClient.client.users.find({
      max: 1,
      email: req.email,
      realm: opts.keycloakRealm,
      exact: true,
    });
    if (keycloakUser.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `User ${req.email} not found`,
        },
      };
    }

    const keycloakUserID = keycloakUser[0].id;
    const user = await userRepo.byId(keycloakUserID!);
    if (!user) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `User ${req.email} not found`,
        },
      };
    }

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const orgInvitation = await orgInvitationRepo.getPendingOrganizationInvitation({
      organizationID: authContext.organizationId,
      userID: user.id,
    });
    if (!orgInvitation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Invite to the user ${req.email} does not exist.`,
        },
      };
    }

    await orgInvitationRepo.removeInvite({
      organizationId: authContext.organizationId,
      userId: user.id,
    });

    const userMemberships = await orgRepo.memberships({ userId: user.id });
    const userPendingInvitations = await orgInvitationRepo.getPendingInvitationsOfUser({ userId: user.id });

    // delete the user only when user doesn't have any memberships and pending invitations
    // this will happen only when the user was invited but the user didn't login and the admin removed that user,
    // in this case the user will not have a personal org
    if (userMemberships.length === 0 && userPendingInvitations.length === 0) {
      await userRepo.deleteUser(
        {
          id: user.id,
          keycloakClient: opts.keycloakClient,
          keycloakRealm: opts.keycloakRealm,
        },
        opts.blobStorage,
        opts.queues.deleteOrganizationAuditLogsQueue,
      );
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'organization_invitation.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      auditableDisplayName: user.email,
      auditableType: 'user',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      targetDisplayName: org.name,
      targetType: 'organization',
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
