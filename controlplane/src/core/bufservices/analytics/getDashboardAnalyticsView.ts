import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetDashboardAnalyticsViewRequest,
  GetDashboardAnalyticsViewResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { AnalyticsDashboardViewRepository } from '../../repositories/analytics/AnalyticsDashboardViewRepository.js';
import { parseTimeFilters } from '../../repositories/analytics/util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';

export function getDashboardAnalyticsView(
  opts: RouterOptions,
  req: GetDashboardAnalyticsViewRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetDashboardAnalyticsViewResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetDashboardAnalyticsViewResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        mostRequestedOperations: [],
        requestSeries: [],
        subgraphMetrics: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        mostRequestedOperations: [],
        requestSeries: [],
        subgraphMetrics: [],
      };
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const { range, dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      range: req.range,
      dateRange:
        req.startDate !== '' && req.endDate !== ''
          ? {
              start: req.startDate,
              end: req.endDate,
            }
          : undefined,
    });

    const timeFilters = parseTimeFilters(dateRange, range);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphs = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: graph.targetId,
      published: true,
    });
    const view = await analyticsDashRepo.getView(graph.id, authContext.organizationId, timeFilters, subgraphs);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      mostRequestedOperations: view.mostRequestedOperations,
      requestSeries: view.requestSeries,
      subgraphMetrics: view.subgraphMetrics,
      federatedGraphMetrics: view.federatedGraphMetrics,
    };
  });
}
