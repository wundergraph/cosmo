import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteOrganizationGroupRequest,
  DeleteOrganizationGroupResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';
import { OidcRepository } from '../../repositories/OidcRepository.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { OrganizationGroupDTO } from '../../../types/index.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import OidcProvider from '../../services/OidcProvider.js';

export function deleteOrganizationGroup(
  opts: RouterOptions,
  req: DeleteOrganizationGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOrganizationGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOrganizationGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return opts.db.transaction(async (tx) => {
      const orgRepo = new OrganizationRepository(logger, tx);
      const orgGroupRepo = new OrganizationGroupRepository(tx);
      const auditLogRepo = new AuditLogRepository(tx);
      const oidcRepo = new OidcRepository(tx);

      if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdmin) {
        throw new UnauthorizedError();
      }

      const rbac = await orgRepo.getFeature({ organizationId: authContext.organizationId, featureId: 'rbac' });
      if (!rbac?.enabled) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `RBAC feature is not enabled for this organization.`,
          },
        };
      }

      const orgGroup = await orgGroupRepo.byId({
        organizationId: authContext.organizationId,
        groupId: req.groupId,
      });

      if (!orgGroup) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: 'Group not found',
          },
        };
      }

      if (orgGroup.builtin) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: 'Builtin groups cannot be deleted.',
          },
        };
      }

      await opts.keycloakClient.authenticateClient();

      // Retrieve the OIDC mappers that have been assigned to the group
      const oidc = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });

      let oidcMappersForGroup: { id: string; claims: string }[] = [];
      if (oidc) {
        const oidcProvider = new OidcProvider();
        const oidcMappers = await oidcProvider.fetchIDPMappers({
          kcClient: opts.keycloakClient,
          kcRealm: opts.keycloakRealm,
          alias: oidc.alias,
          organizationId: authContext.organizationId,
          db: opts.db,
        });

        oidcMappersForGroup = oidcMappers.filter((mapper) => mapper.groupId === orgGroup.groupId);
      }

      // If the group have one member or the organization OIDC is enabled, we need to move the members to the
      // destination group and update the OIDC mappers
      let moveToGroup: OrganizationGroupDTO | undefined;
      if (orgGroup.membersCount > 0 || orgGroup.apiKeysCount > 0 || oidcMappersForGroup.length > 0) {
        if (req.toGroupId) {
          moveToGroup = await orgGroupRepo.byId({ organizationId: authContext.organizationId, groupId: req.toGroupId });
        }

        if (!moveToGroup) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: 'No group to move existing members and mappers to was provided',
            },
          };
        }

        // Change the Keycloak group of all the members belonging to this group
        // We don't need to delete group for the user since it will be automatically deleted when the
        // group is deleted
        const [usersOfGroup] = await orgGroupRepo.getGroupMembers(orgGroup.groupId);
        if (usersOfGroup.length > 0 && moveToGroup.kcGroupId) {
          for (const user of usersOfGroup) {
            const kcUser = await opts.keycloakClient.client.users.find({
              realm: opts.keycloakRealm,
              email: user.email,
              exact: true,
            });

            if (kcUser.length === 0) {
              continue;
            }

            await opts.keycloakClient.client.users.addToGroup({
              realm: opts.keycloakRealm,
              id: kcUser[0].id!,
              groupId: moveToGroup.kcGroupId,
            });
          }
        }

        // Change all the group members and API keys to the target group
        await orgGroupRepo.changeMemberGroup({
          fromGroupId: orgGroup.groupId,
          toGroupId: moveToGroup.groupId,
        });

        await auditLogRepo.addAuditLog({
          organizationId: authContext.organizationId,
          organizationSlug: authContext.organizationSlug,
          auditAction: 'group.members_moved',
          action: 'updated',
          actorId: authContext.userId,
          auditableDisplayName: moveToGroup.name,
          auditableType: 'group',
          actorDisplayName: authContext.userDisplayName,
          targetType: 'group',
          targetDisplayName: orgGroup.name,
          apiKeyName: authContext.apiKeyName,
          actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
        });
      }

      // When the organization have linked an OIDC provider, we need to update the mappers that were tied
      // to the group we are deleting
      if (oidc && oidcMappersForGroup.length > 0 && moveToGroup) {
        for (const mapper of oidcMappersForGroup) {
          // To update the mapper, we need to delete the existing mapper and create a new one with the same claims.
          //
          // NOTES:
          // I tried using the `updateMapper` Keycloak method, however, it throw an exception with "internal error"
          // every time, the Keycloak log said tried to update a mapper that didn't exist, even when using the
          // parameters as returned by Keycloak
          await opts.keycloakClient.client.identityProviders.delMapper({
            realm: opts.keycloakRealm,
            alias: oidc.alias,
            id: mapper.id,
          });

          await opts.keycloakClient.createIDPMapper({
            realm: opts.keycloakRealm,
            alias: oidc.alias,
            keycloakGroupName: `/${authContext.organizationSlug}/${moveToGroup.name}`,
            claims: mapper.claims,
          });
        }
      }

      // Delete the group from Keycloak and the database
      if (orgGroup.kcGroupId) {
        await opts.keycloakClient.client.groups.del({
          realm: opts.keycloakRealm,
          id: orgGroup.kcGroupId,
        });
      }

      await orgGroupRepo.deleteById(orgGroup.groupId);

      // Finally, create a log entry for the deleted group
      await auditLogRepo.addAuditLog({
        organizationId: authContext.organizationId,
        organizationSlug: authContext.organizationSlug,
        auditAction: 'group.deleted',
        action: 'deleted',
        actorId: authContext.userId,
        auditableDisplayName: orgGroup.name,
        auditableType: 'group',
        actorDisplayName: authContext.userDisplayName,
        apiKeyName: authContext.apiKeyName,
        actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      });

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
