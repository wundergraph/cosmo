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
import { OrganizationGroupDTO } from '../../../types/index.js';

export function updateOrgMemberGroup(
  opts: RouterOptions,
  req: UpdateOrgMemberGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateOrgMemberGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateOrgMemberGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    return opts.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(logger, tx, opts.billingDefaultPlanId);
      const orgGroupRepo = new OrganizationGroupRepository(tx);
      const oidcRepo = new OidcRepository(tx);
      const auditLogRepo = new AuditLogRepository(tx);

      const org = await orgRepo.byId(authContext.organizationId);
      if (!org) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Organization not found`,
          },
        };
      }

      // Fetch the organization member from the database
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

      // Ensure that the organization member has not signed in with SSO
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

      // Retrieve the Keycloak user
      await opts.keycloakClient.authenticateClient();

      const users = await opts.keycloakClient.client.users.find({
        realm: opts.keycloakRealm,
        email: orgMember.email,
        exact: true,
      });

      if (users.length === 0) {
        // The user doesn't exist in Keycloak
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'User does not exist.',
          },
        };
      }

      // Load all the group the member should be part of from the database
      const groups: OrganizationGroupDTO[] = [];
      const uniqueGroupIds = [...new Set(req.groups)];
      groups.push(
        ...(await orgGroupRepo.byIds({
          organizationId: authContext.organizationId,
          groupIds: uniqueGroupIds,
        })),
      );

      if (groups.length !== uniqueGroupIds.length) {
        // One or more of the submitted groups
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `One of the submitted groups is not part of this organization`,
          },
        };
      }

      for (const groupId of new Set(req.groups)) {
        const orgGroup = await orgGroupRepo.byId({ organizationId: authContext.organizationId, groupId });
        if (!orgGroup) {
          // The group doesn't exist for the organization
          return {
            response: {
              code: EnumStatusCode.ERR_NOT_FOUND,
              details: `One of the submitted groups is not part of this organization`,
            },
          };
        }

        groups.push(orgGroup);
      }

      // Figure out which groups we need to remove the user from and to add the user to
      const newGroups = new Set(groups.filter(Boolean).map((group) => group.groupId));

      if (newGroups.size === 0) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'The organization member must have at least one group',
          },
        };
      }

      const existingGroups = new Set(orgMember.rbac.groups.map((group) => group.groupId));

      const groupsToAddTo = newGroups.difference(existingGroups);
      const groupsToRemoveFrom = existingGroups.difference(newGroups);

      if (groupsToAddTo.size === 0 && groupsToRemoveFrom.size === 0) {
        // We don't need to remove or add the group from/to any group
        return {
          response: {
            code: EnumStatusCode.OK,
          },
        };
      }

      // Remove the member from removed groups
      for (const groupId of groupsToRemoveFrom) {
        const group = orgMember.rbac.groups.find((g) => g.groupId === groupId);
        if (!group?.kcGroupId) {
          // The group hasn't been linked to Keycloak, skip
          continue;
        }

        await opts.keycloakClient.client.users.delFromGroup({
          id: users[0].id!,
          realm: opts.keycloakRealm,
          groupId: group.kcGroupId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'member_group.removed',
          action: 'removed',
          actorId: authContext.userId,
          auditableDisplayName: group.name,
          auditableType: 'member_group',
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          targetId: orgMember.userID,
          targetType: 'user',
          targetDisplayName: orgMember.email,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });
      }

      // Add the member to added groups
      for (const groupId of groupsToAddTo) {
        const group = groups.find((g) => g.groupId === groupId);
        if (!group?.kcGroupId) {
          // The group hasn't been linked to Keycloak, skip
          continue;
        }

        await opts.keycloakClient.client.users.addToGroup({
          id: users[0].id!,
          realm: opts.keycloakRealm,
          groupId: group.kcGroupId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'member_group.added',
          action: 'added',
          actorId: authContext.userId,
          auditableDisplayName: group.name,
          auditableType: 'member_group',
          actorDisplayName: authContext.userDisplayName,
          apiKeyName: authContext.apiKeyName,
          targetId: orgMember.userID,
          targetType: 'user',
          targetDisplayName: orgMember.email,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });
      }

      // Update the groups from the member
      await orgRepo.updateMemberGroups({ orgMemberID: orgMember.orgMemberID, groups: [...newGroups] });

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
