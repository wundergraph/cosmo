import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationRequestsCountRequest,
  GetOrganizationRequestsCountResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { MonthlyRequestViewRepository } from '../../repositories/analytics/MonthlyRequestViewRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getOrganizationRequestsCount(
  opts: RouterOptions,
  req: GetOrganizationRequestsCountRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationRequestsCountResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationRequestsCountResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        count: BigInt(0),
      };
    }
    const monthlyRequestsRepo = new MonthlyRequestViewRepository(opts.chClient);
    const count = await monthlyRequestsRepo.getMonthlyRequestCount(authContext.organizationId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      count: BigInt(count),
    };
  });
}
