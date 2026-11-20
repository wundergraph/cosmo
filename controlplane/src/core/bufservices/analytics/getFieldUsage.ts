import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetFieldUsageRequest, GetFieldUsageResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage, DateRange } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { UsageRepository } from '../../repositories/analytics/UsageRepository.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { enforceAnalyticsRateLimit, isMcpRequest } from '../../services/AnalyticsRateLimiter.js';

// Schema usage is kept for 90 days, but is shown within the plan's analytics retention, like Studio's date pickers.
const FIELD_USAGE_RETENTION_FEATURE = 'analytics-retention';

export function getFieldUsage(
  opts: RouterOptions,
  req: GetFieldUsageRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFieldUsageResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFieldUsageResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader, {
      skipApiKeyUsageUpdate: isMcpRequest(ctx.requestHeader),
    });
    logger = enrichLogger(ctx, logger, authContext);
    await enforceAnalyticsRateLimit(opts, ctx, authContext.organizationId);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        clients: [],
        requestSeries: [],
      };
    }

    const usageRepo = new UsageRepository(opts.chClient);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        clients: [],
        requestSeries: [],
      };
    }

    const graph = await federatedGraphRepo.byName(req.graphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
        clients: [],
        requestSeries: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    let dr: DateRange | undefined;

    if (req.dateRange?.start && req.dateRange?.end) {
      dr = {
        start: req.dateRange?.start,
        end: req.dateRange?.end,
      };
    }

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const retention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: FIELD_USAGE_RETENTION_FEATURE,
    });
    const { range, dateRange, outOfRetention } = validateDateRanges({
      limit: retention?.limit ?? 7,
      range: req.range,
      dateRange: dr,
    });

    if (outOfRetention) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        clients: [],
        requestSeries: [],
      };
    }

    const { clients, requestSeries, meta } = await usageRepo.getFieldUsage({
      federatedGraphId: graph.id,
      organizationId: authContext.organizationId,
      typename: req.typename,
      field: req.field,
      namedType: req.namedType,
      range,
      dateRange,
      isArgument: req.isArgument ?? false, // default to false if not provided
      isInput: req.isInput ?? false, // default to false if not provided
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      clients,
      requestSeries,
      meta,
    };
  });
}
