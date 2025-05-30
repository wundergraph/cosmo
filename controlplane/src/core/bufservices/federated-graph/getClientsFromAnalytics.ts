import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetClientsFromAnalyticsRequest,
  GetClientsFromAnalyticsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { MetricsRepository } from '../../repositories/analytics/MetricsRepository.js';

export function getClientsFromAnalytics(
  opts: RouterOptions,
  req: GetClientsFromAnalyticsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetClientsFromAnalyticsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetClientsFromAnalyticsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        clients: [],
      };
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' does not exist`,
        },
        clients: [],
      };
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const limit = analyticsRetention?.limit ?? 7;

    const { range } = validateDateRanges({
      limit,
      range: limit * 24,
    });

    if (!range) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        clients: [],
      };
    }

    const metricsRepo = new MetricsRepository(opts.chClient);
    const clients = await metricsRepo.getClients({
      range,
      graphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      filters: [],
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      clients,
    };
  });
}
