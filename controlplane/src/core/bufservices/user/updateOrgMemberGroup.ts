import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrgMemberGroupRequest,
  UpdateOrgMemberGroupResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function updateOrgMemberGroup(
  opts: RouterOptions,
  req: UpdateOrgMemberGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrgMemberGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrgMemberGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const oidcRepo = new OidcRepository(opts.db);
    const auditLogRepo = new AuditLogRepository(opts.db);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
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

    // fetch the group the member will be added to
    const orgGroup = await orgGroupRepo.byId({
      organizationId: authContext.organizationId,
      groupId: req.groupId,
    });

    if (!orgGroup) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Group is not part of this organization`,
        },
      };
    }

    // fetching the user who is updating the other member's role.
    const user = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: authContext.userId || req.userID,
    });

    if (!user) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    // fetching the user whose group is being updated.
    const orgMember = await orgRepo.getOrganizationMember({
      organizationID: authContext.organizationId,
      userID: req.orgMemberUserID,
    });

    if (!orgMember) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User is not a part of this organization.',
        },
      };
    }

    if (orgMember.rbac.groups.some((g) => g.groupId === orgGroup.groupId)) {
      // The user is already a member of the provided group
      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    }

    await opts.keycloakClient.authenticateClient();

    const users = await opts.keycloakClient.client.users.find({
      realm: opts.keycloakRealm,
      email: orgMember.email,
      exact: true,
    });

    if (users.length === 0) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User does not exist.',
        },
      };
    }

    const provider = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });

    if (provider) {
      // checking if the user has logged in using the sso
      const ssoUser = await opts.keycloakClient.client.users.find({
        realm: opts.keycloakRealm,
        email: orgMember.email,
        exact: true,
        idpAlias: provider.alias,
      });

      if (ssoUser.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'User has logged in using the OIDC provider. Please update the group using the provider.',
          },
        };
      }
    }

    const userGroups = await orgRepo.getOrganizationMemberGroups({
      userID: orgMember.userID,
      organizationID: authContext.organizationId,
    });

    if (userGroups.some((ug) => ug.groupId === orgGroup.groupId)) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    }

    // delete current groups
    for (const group of userGroups) {
      if (!group.kcGroupId) {
        continue;
      }

      await opts.keycloakClient.client.users.delFromGroup({
        id: users[0].id!,
        realm: opts.keycloakRealm,
        groupId: group.kcGroupId,
      });
    }

    if (orgGroup.kcGroupId) {
      await opts.keycloakClient.client.users.addToGroup({
        id: users[0].id!,
        realm: opts.keycloakRealm,
        groupId: orgGroup.kcGroupId,
      });
    }

    await orgRepo.updateUserGroup({
      orgMemberID: orgMember.orgMemberID,
      groupId: orgGroup.groupId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'member_group.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableDisplayName: orgGroup.name,
      auditableType: 'member_group',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      targetId: orgMember.userID,
      targetType: 'user',
      targetDisplayName: orgMember.email,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
