import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationMembersRequest,
  GetOrganizationMembersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getOrganizationMembers(
  opts: RouterOptions,
  req: GetOrganizationMembersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationMembersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationMembersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const orgMembers = await orgRepo.getMembers({
      organizationID: authContext.organizationId,
      offset: req.pagination?.offset,
      limit: req.pagination?.limit,
      search: req.search,
    });

    const count = await orgRepo.memberCount(authContext.organizationId, req.search);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      members: orgMembers.map(({ rbac, ...rest }) => ({
        ...rest,
        groups: rbac.groups,
      })),
      totalCount: count,
    };
  });
}
