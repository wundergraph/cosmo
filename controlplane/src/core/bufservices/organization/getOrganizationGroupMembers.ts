import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationGroupMembersRequest,
  GetOrganizationGroupMembersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';

export function getOrganizationGroupMembers(
  opts: RouterOptions,
  req: GetOrganizationGroupMembersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationGroupMembersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationGroupMembersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const orgGroup = await orgGroupRepo.byId({
      organizationId: authContext.organizationId,
      groupId: req.groupId,
    });

    if (!orgGroup) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
        members: [],
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      members: await orgGroupRepo.getGroupMembers(orgGroup.groupId),
    };
  });
}
