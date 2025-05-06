import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetInvitationsRequest, GetInvitationsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationInvitationRepository } from '../../repositories/OrganizationInvitationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getInvitations(
  opts: RouterOptions,
  req: GetInvitationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetInvitationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetInvitationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgInvitationRepo = new OrganizationInvitationRepository(logger, opts.db, opts.billingDefaultPlanId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      invitations: await orgInvitationRepo.getPendingInvitationsOfUser({ userId: authContext.userId }),
    };
  });
}
