import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetGraphFieldUsageRequest,
  GetGraphFieldUsageResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { isValid } from 'date-fns';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UsageRepository } from '../../repositories/analytics/UsageRepository.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';
import { isoDateRangeToTimestamps, getDateRange } from '../../repositories/analytics/util.js';
import type { PlainMessage } from '../../../types/index.js';

export function getGraphFieldUsage(
  opts: RouterOptions,
  req: GetGraphFieldUsageRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetGraphFieldUsageResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetGraphFieldUsageResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        fields: [],
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.graphName}' not found`,
        },
        fields: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const inputRange = req.range ?? (req.dateRange ? undefined : 24);
    const { range, dateRange: validatedDateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      range: inputRange,
      dateRange: req.dateRange,
    });

    // validateDateRanges accepts unparsable dates and negative ranges, and drops an invalid date range without an error.
    const isInvalid =
      req.dateRange === undefined
        ? req.range !== undefined && req.range < 1
        : !isValid(new Date(req.dateRange.start)) || !isValid(new Date(req.dateRange.end)) || !validatedDateRange;
    if (isInvalid) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        fields: [],
      };
    }

    const parsedDateRange = isoDateRangeToTimestamps(validatedDateRange, range);
    const [start, end] = getDateRange(parsedDateRange);

    const usageRepo = new UsageRepository(opts.chClient);
    const fields = await usageRepo.getGraphFieldUsage({
      organizationId: authContext.organizationId,
      federatedGraphId: graph.id,
      dateRange: { start, end },
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      fields: fields.map((field) => ({
        typeName: field.typeName,
        fieldName: field.fieldName,
        requestCount: BigInt(field.requestCount),
      })),
      dateRange: {
        start: new Date(start * 1000).toISOString(),
        end: new Date(end * 1000).toISOString(),
      },
    };
  });
}
