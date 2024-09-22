import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  IsMemberLimitReachedRequest,
  IsMemberLimitReachedResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function isMemberLimitReached(
  opts: RouterOptions,
  req: IsMemberLimitReachedRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<IsMemberLimitReachedResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<IsMemberLimitReachedResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const count = await orgRepo.memberCount(authContext.organizationId);

    const usersFeature = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'users',
    });
    const limit = usersFeature?.limit === -1 ? undefined : usersFeature?.limit;
    const limitReached = !!limit && count >= limit;

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      limitReached,
      memberCount: count,
    };
  });
}
