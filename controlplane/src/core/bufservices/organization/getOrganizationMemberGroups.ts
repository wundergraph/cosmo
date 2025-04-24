import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationMemberGroupsRequest,
  GetOrganizationMemberGroupsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationMemberGroupRepository } from '../../repositories/OrganizationMemberGroupRepository.js';

export function getOrganizationMemberGroups(
  opts: RouterOptions,
  req: GetOrganizationMemberGroupsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationMemberGroupsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationMemberGroupsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgMemberGroupRepo = new OrganizationMemberGroupRepository(opts.db);

    const groups = await orgMemberGroupRepo.forOrganization(authContext.organizationId);
    if (groups.length === 0) {
      // The organization doesn't have any rule set, we should retrieve the legacy groups and create rule set for
      // them, that way the organization may manage them
      await opts.keycloakClient.authenticateClient();
      const organizationGroups = await opts.keycloakClient.client.groups.find({
        max: -1,
        search: authContext.organizationSlug,
        realm: opts.keycloakRealm,
        briefRepresentation: false,
      });

      if (organizationGroups.length > 0) {
        const subGroups = await opts.keycloakClient.fetchAllSubGroups({
          realm: opts.keycloakRealm,
          kcGroupId: organizationGroups[0].id!,
        });

        for (const group of subGroups) {
          groups.push(
            await orgMemberGroupRepo.create({
              organizationId: authContext.organizationId,
              name: group.name!,
              kcGroupId: group.id!,
            }),
          );
        }
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      groups: groups.map(({ id, kcGroupId, ...rest }) => ({
        groupId: id,
        ...rest,
      }))
    };
  });
}
