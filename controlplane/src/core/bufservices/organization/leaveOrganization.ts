import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  LeaveOrganizationRequest,
  LeaveOrganizationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function leaveOrganization(
  opts: RouterOptions,
  req: LeaveOrganizationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<LeaveOrganizationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<LeaveOrganizationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    const org = await orgRepo.byId(authContext.organizationId);
    if (!org) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Organization not found`,
        },
      };
    }

    const orgMember = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
    });

    if (!orgMember) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    // the creator of the personal org cannot leave the organization.
    if (org.creatorUserId === (authContext.userId || req.userID)) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Creator of a organization cannot leave the organization.`,
        },
      };
    }

    // checking if the user is a single admin
    if (orgMember.roles.includes('admin')) {
      const orgAdmins = await orgRepo.getOrganizationAdmins({ organizationID: authContext.organizationId });
      if (orgAdmins.length === 1) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Single admins cannot leave the organization. Please make another member an admin and try again.',
          },
        };
      }
    }

    await opts.keycloakClient.authenticateClient();

    const organizationGroup = await opts.keycloakClient.client.groups.find({
      max: 1,
      search: org.slug,
      realm: opts.keycloakRealm,
    });

    if (organizationGroup.length === 0) {
      throw new Error(`Organization group '${org.slug}' not found`);
    }

    // removing the group from the keycloak user
    await opts.keycloakClient.client.users.delFromGroup({
      id: orgMember.userID,
      groupId: organizationGroup[0].id!,
      realm: opts.keycloakRealm,
    });

    // removing the user for the organization in the db
    await orgRepo.removeOrganizationMember({
      userID: authContext.userId || req.userID,
      organizationID: authContext.organizationId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'organization.left',
      action: 'left',
      actorId: authContext.userId,
      auditableType: 'organization',
      auditableDisplayName: org.name,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
