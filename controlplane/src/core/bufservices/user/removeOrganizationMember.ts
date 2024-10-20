import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RemoveOrganizationMemberRequest,
  RemoveOrganizationMemberResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UserRepository } from '../../repositories/UserRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function removeOrganizationMember(
  opts: RouterOptions,
  req: RemoveOrganizationMemberRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RemoveOrganizationMemberResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RemoveOrganizationMemberResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const auditLogRepo = new AuditLogRepository(opts.db);
    const userRepo = new UserRepository(logger, opts.db);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
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

    const orgMember = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: user.id,
    });
    if (!orgMember) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `User ${req.email} is not a part of this organization.`,
        },
      };
    }

    if (org.creatorUserId === user.id) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The creator of this organization ${req.email} cannot be removed from the organization.`,
        },
      };
    }

    await opts.keycloakClient.authenticateClient();

    await opts.keycloakClient.removeUserFromOrganization({
      realm: opts.keycloakRealm,
      userID: user.id,
      groupName: org.slug,
      roles: orgMember.roles,
    });

    await orgRepo.removeOrganizationMember({ organizationID: authContext.organizationId, userID: user.id });

    const userMemberships = await orgRepo.memberships({ userId: user.id });

    // delete the user only when user doesn't have any memberships
    // this will happen only when the user was invited but the user didn't login and the admin removed that user,
    // in this case the user will not have a personal org
    if (userMemberships.length === 0) {
      await userRepo.deleteUser({
        id: user.id,
        keycloakClient: opts.keycloakClient,
        keycloakRealm: opts.keycloakRealm,
      });
    }

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'organization_member.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      auditableDisplayName: req.email,
      auditableType: 'user',
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
