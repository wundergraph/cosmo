import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetPendingOrganizationMembersRequest,
  GetPendingOrganizationMembersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationInvitationRepository } from '../../repositories/OrganizationInvitationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getPendingOrganizationMembers(
  opts: RouterOptions,
  req: GetPendingOrganizationMembersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetPendingOrganizationMembersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetPendingOrganizationMembersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const pendingInvitations = await orgInvitationRepo.getPendingInvitationsOfOrganization({
      organizationId: authContext.organizationId,
      offset: req.pagination?.offset,
      limit: req.pagination?.limit,
      search: req.search,
    });

    const count = await orgInvitationRepo.pendingInvitationsCount(authContext.organizationId, req.search);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      pendingInvitations,
      totalCount: count,
    };
  });
}
