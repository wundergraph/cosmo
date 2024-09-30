import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAnalyticsViewRequest,
  GetAnalyticsViewResponse,
  DateRange as DateRangeProto,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { AnalyticsRequestViewRepository } from '../../repositories/analytics/AnalyticsRequestViewRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';

export function getAnalyticsView(
  opts: RouterOptions,
  req: GetAnalyticsViewRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAnalyticsViewResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAnalyticsViewResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const analyticsRepo = new AnalyticsRequestViewRepository(opts.chClient);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
      };
    }

    const tracingRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'tracing-retention',
    });

    const { range, dateRange } = validateDateRanges({
      limit: tracingRetention?.limit ?? 7,
      range: req.config?.range,
      dateRange: req.config?.dateRange,
    });

    if (req.config) {
      if (range) {
        req.config.range = range;
      }
      if (dateRange) {
        req.config.dateRange = new DateRangeProto({
          start: dateRange.start,
          end: dateRange.end,
        });
      }
    }

    const view = await analyticsRepo.getView(authContext.organizationId, graph.id, req.name, req.config);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      view,
    };
  });
}
