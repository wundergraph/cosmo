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
import { AuditLogRepository } from "../../repositories/AuditLogRepository.js";

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
      const orgGroupRepo = new OrganizationGroupRepository(tx);
      const auditLogRepo = new AuditLogRepository(tx);
      const oidcRepo = new OidcRepository(tx);

      const orgGroup = await orgGroupRepo.byId({
        organizationId: authContext.organizationId,
        groupId: req.groupId,
      });

      if (!orgGroup) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
        };
      }

      await orgGroupRepo.deleteById(orgGroup.id);

      await opts.keycloakClient.authenticateClient();
      if (orgGroup.kcGroupId) {
        // Delete the group from Keycloak
        await opts.keycloakClient.client.groups.del({
          realm: opts.keycloakRealm,
          id: orgGroup.kcGroupId,
        });
      }

      const oidc = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
      if (oidc && orgGroup.kcMapperId) {
        await opts.keycloakClient.client.identityProviders.delMapper({
          realm: opts.keycloakRealm,
          alias: oidc.alias,
          id: orgGroup.kcMapperId,
        });
      }

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
