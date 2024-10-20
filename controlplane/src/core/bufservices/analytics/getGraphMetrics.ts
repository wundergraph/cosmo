import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetGraphMetricsRequest,
  GetGraphMetricsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';

export function getGraphMetrics(
  opts: RouterOptions,
  req: GetGraphMetricsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetGraphMetricsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetGraphMetricsResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        filters: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new MetricsRepository(opts.chClient);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        filters: [],
      };
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const { range, dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      range: req.range,
      dateRange: req.dateRange,
    });

    const view = await repo.getMetricsView({
      range,
      dateRange,
      filters: req.filters,
      organizationId: authContext.organizationId,
      graphId: graph.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      ...view,
    };
  });
}
