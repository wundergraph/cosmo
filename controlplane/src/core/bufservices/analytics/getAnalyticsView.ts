import { create } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAnalyticsViewRequest,
  GetAnalyticsViewResponse,
  DateRangeSchema as DateRangeProtoSchema,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { AnalyticsRequestViewRepository } from '../../repositories/analytics/AnalyticsRequestViewRepository.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';
import { enforceAnalyticsRateLimit, isMcpRequest } from '../../services/AnalyticsRateLimiter.js';

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
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader, {
      skipApiKeyUsageUpdate: isMcpRequest(ctx.requestHeader),
    });
    logger = enrichLogger(ctx, logger, authContext);
    await enforceAnalyticsRateLimit(opts, ctx, authContext.organizationId);

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

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const tracingRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'tracing-retention',
    });

    const { range, dateRange, outOfRetention } = validateDateRanges({
      limit: tracingRetention?.limit ?? 7,
      range: req.config?.range,
      dateRange: req.config?.dateRange,
    });

    if (outOfRetention) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        view: { columns: [], rows: [], filters: [], pages: 0 },
      };
    }

    if (req.config) {
      if (range) {
        req.config.range = range;
      } else if (!dateRange) {
        req.config.range = 24;
      }
      if (dateRange) {
        req.config.dateRange = create(DateRangeProtoSchema, {
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
