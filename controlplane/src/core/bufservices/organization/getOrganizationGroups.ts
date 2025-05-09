import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationGroupsRequest,
  GetOrganizationGroupsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationGroupRepository } from '../../repositories/OrganizationGroupRepository.js';

export function getOrganizationGroups(
  opts: RouterOptions,
  req: GetOrganizationGroupsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationGroupsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationGroupsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgGroupRepo = new OrganizationGroupRepository(opts.db);
    const groups = await orgGroupRepo.forOrganization(authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      groups: groups.map(({ kcGroupId, kcMapperId, ...rest }) => ({
        ...rest,
      })),
    };
  });
}
