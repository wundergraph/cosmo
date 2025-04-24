import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationAvailableMemberGroupsRequest,
  GetOrganizationAvailableMemberGroupsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationMemberGroupRepository } from '../../repositories/OrganizationMemberGroupRepository.js';

export function getOrganizationAvailableMemberGroups(
  opts: RouterOptions,
  req: GetOrganizationAvailableMemberGroupsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationAvailableMemberGroupsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationAvailableMemberGroupsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgMemberGroupRepo = new OrganizationMemberGroupRepository(opts.db);
    const memberGroups = await orgMemberGroupRepo.listForOrganization(authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      groups: memberGroups.map(({ id, name }) => ({
        groupId: id,
        name,
      })),
    };
  });
}
