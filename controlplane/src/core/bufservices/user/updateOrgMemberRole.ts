import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateOrgMemberRoleRequest,
  UpdateOrgMemberRoleResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getHighestPriorityRole, getLogger, handleError } from '../../util.js';
import type { MemberRole } from '../../../db/models.js';

export function updateOrgMemberRole(
  opts: RouterOptions,
  req: UpdateOrgMemberRoleRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrgMemberRoleResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrgMemberRoleResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const oidcRepo = new OidcRepository(opts.db);
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

    // non admins cannot update the role of an org member
    if (!user.roles.includes('admin')) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'User does not have the permissions to update the role of an organization member.',
        },
      };
    }

    // fetching the user whose role is being updated.
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
            details: 'User has logged in using the OIDC provider. Please update the role using the provider.',
          },
        };
      }
    }

    const organizationGroups = await opts.keycloakClient.client.groups.find({
      max: 1,
      search: org.slug,
      realm: opts.keycloakRealm,
      briefRepresentation: false,
    });

    if (organizationGroups.length === 0) {
      throw new Error(`Organization group '${org.slug}' not found`);
    }

    const userRoles = await orgRepo.getOrganizationMemberRoles({
      userID: orgMember.userID,
      organizationID: authContext.organizationId,
    });
    const highPriorityRole = getHighestPriorityRole({ userRoles });
    if (highPriorityRole === req.role) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    }

    const organizationSubGroups = await opts.keycloakClient.fetchAllSubGroups({
      realm: opts.keycloakRealm,
      kcGroupId: organizationGroups[0].id!,
    });

    const targetGroup = organizationSubGroups.find((group) => group.name === req.role);
    if (!targetGroup) {
      throw new Error(`Invalid role ${req.role}`);
    }

    // deleting current roles
    for (const role of userRoles) {
      const childGroup = organizationSubGroups.find((group) => group.name === role);
      if (!childGroup) {
        continue;
      }

      await opts.keycloakClient.client.users.delFromGroup({
        id: users[0].id!,
        realm: opts.keycloakRealm,
        groupId: childGroup.id!,
      });
    }

    await opts.keycloakClient.client.users.addToGroup({
      id: users[0].id!,
      realm: opts.keycloakRealm,
      groupId: targetGroup.id!,
    });

    await orgRepo.updateUserRole({
      orgMemberID: orgMember.orgMemberID,
      role: req.role as MemberRole,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'member_role.updated',
      action: 'updated',
      actorId: authContext.userId,
      auditableDisplayName: req.role,
      auditableType: 'member_role',
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
