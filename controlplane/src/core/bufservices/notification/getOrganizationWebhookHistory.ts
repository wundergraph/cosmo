import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationWebhookHistoryRequest,
  GetOrganizationWebhookHistoryResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getOrganizationWebhookHistory(
  opts: RouterOptions,
  req: GetOrganizationWebhookHistoryRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationWebhookHistoryResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationWebhookHistoryResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    if (!authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const { dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      dateRange: req.dateRange,
    });

    if (!dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        deliveries: [],
        totalCount: 0,
      };
    }

    const { deliveries, totalCount } = await orgRepo.getWebhookHistory({
      organizationID: authContext.organizationId,
      limit: req.pagination?.limit,
      offset: req.pagination?.offset,
      filterByType: req.filterByType,
      startDate: dateRange.start,
      endDate: dateRange.end,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      deliveries,
      totalCount,
    };
  });
}
