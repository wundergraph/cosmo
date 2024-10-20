import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  AcceptOrDeclineInvitationRequest,
  AcceptOrDeclineInvitationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationInvitationRepository } from '../../repositories/OrganizationInvitationRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function acceptOrDeclineInvitation(
  opts: RouterOptions,
  req: AcceptOrDeclineInvitationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<AcceptOrDeclineInvitationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<AcceptOrDeclineInvitationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const userRepo = new UserRepository(logger, opts.db);
    const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const user = await userRepo.byId(authContext.userId);
    if (!user) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `User ${authContext.userId} not found`,
        },
      };
    }

    const organization = await orgRepo.byId(req.organizationId);
    if (!organization) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization ${req.organizationId} not found`,
        },
      };
    }

    if (req.accept) {
      const groupName = organization.slug;

      await opts.keycloakClient.authenticateClient();

      const organizationGroups = await opts.keycloakClient.client.groups.find({
        max: 1,
        search: groupName,
        realm: opts.keycloakRealm,
      });

      if (organizationGroups.length === 0) {
        throw new Error(`Organization group '${groupName}' not found`);
      }

      const devGroup = await opts.keycloakClient.fetchChildGroup({
        realm: opts.keycloakRealm,
        kcGroupId: organizationGroups[0].id!,
        orgSlug: groupName,
        childGroupType: 'developer',
      });

      const keycloakUser = await opts.keycloakClient.client.users.find({
        max: 1,
        email: user.email,
        realm: opts.keycloakRealm,
        exact: true,
      });

      if (keycloakUser.length === 0) {
        throw new Error(`Keycloak user with email '${user.email}' not found`);
      }

      await opts.keycloakClient.client.users.addToGroup({
        id: keycloakUser[0].id!,
        groupId: devGroup.id!,
        realm: opts.keycloakRealm,
      });

      await orgInvitationRepo.acceptInvite({ userId: user.id, organizationId: req.organizationId });

      await auditLogRepo.addAuditLog({
        organizationId: req.organizationId,
        auditAction: 'organization.joined',
        action: 'joined',
        actorId: authContext.userId,
        auditableDisplayName: organization.name,
        auditableType: 'organization',
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });
    } else {
      await orgInvitationRepo.removeInvite({ organizationId: req.organizationId, userId: user.id });

      await auditLogRepo.addAuditLog({
        organizationId: req.organizationId,
        auditAction: 'organization_invitation.declined',
        action: 'deleted',
        actorId: authContext.userId,
        auditableDisplayName: organization.name,
        auditableType: 'organization',
        actorDisplayName: authContext.userDisplayName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
