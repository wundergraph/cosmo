import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteOrganizationMemberGroupRequest,
  DeleteOrganizationMemberGroupResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationMemberGroupRepository } from '../../repositories/OrganizationMemberGroupRepository.js';
import { OidcRepository } from "../../repositories/OidcRepository.js";

export function deleteOrganizationMemberGroup(
  opts: RouterOptions,
  req: DeleteOrganizationMemberGroupRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteOrganizationMemberGroupResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteOrganizationMemberGroupResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    return opts.db.transaction(async (tx) => {
      const orgMemberGroupRepo = new OrganizationMemberGroupRepository(tx);
      const oidcRepo = new OidcRepository(tx);

      const memberGroup = await orgMemberGroupRepo.byId({
        organizationId: authContext.organizationId,
        groupId: req.groupId,
      });

      if (!memberGroup) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
          },
        };
      }

      await orgMemberGroupRepo.deleteRuleSet(memberGroup.id);

      await opts.keycloakClient.authenticateClient();
      if (memberGroup.kcGroupId) {
        // Delete the group from Keycloak
        await opts.keycloakClient.client.groups.del({
          realm: opts.keycloakRealm,
          id: memberGroup.kcGroupId,
        });
      }

      const oidc = await oidcRepo.getOidcProvider({ organizationId: authContext.organizationId });
      if (oidc && memberGroup.kcMapperId) {
        await opts.keycloakClient.client.identityProviders.delMapper({
          realm: opts.keycloakRealm,
          alias: oidc.alias,
          id: memberGroup.kcMapperId,
        });
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
      };
    });
  });
}
