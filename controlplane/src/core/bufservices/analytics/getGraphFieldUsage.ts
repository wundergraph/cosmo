import { HandlerContext } from '@connectrpc/connect';
import { validate as isValidUuid } from 'uuid';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetGraphFieldUsageRequest,
  GetGraphFieldUsageResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
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

    const usageRepo = new UsageRepository(opts.chClient);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
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

    const analyticsRetentionInDays = analyticsRetention?.limit ?? 7;
    const { range, dateRange: validatedDateRange } = validateDateRanges({
      limit: analyticsRetentionInDays,
      // Explicit dates never fall back to a relative range, or the caller would get a different window.
      range: req.dateRange ? undefined : (req.range ?? 24),
      dateRange: req.dateRange,
    });

    const isRelativeRangeValid = range !== undefined && range > 0;
    const isExplicitRangeValid =
      validatedDateRange !== undefined &&
      Number.isFinite(new Date(validatedDateRange.start).getTime()) &&
      Number.isFinite(new Date(validatedDateRange.end).getTime());

    if (req.dateRange ? !isExplicitRangeValid : !isRelativeRangeValid) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        fields: [],
      };
    }

    const parsedDateRange = isoDateRangeToTimestamps(validatedDateRange, range);
    const [startTimestamp, endTimestamp] = getDateRange(parsedDateRange);

    const fieldsData = await usageRepo.getGraphFieldUsage({
      organizationId: authContext.organizationId,
      federatedGraphId: graph.id,
      dateRange: {
        start: startTimestamp,
        end: endTimestamp,
      },
    });

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphNames = await subgraphRepo.getSubgraphNameByIds(
      // A router config composed with wgc numbers its subgraphs, and Postgres rejects a non-UUID id.
      fieldsData.flatMap((field) =>
        field.subgraphs.map((subgraph) => subgraph.subgraphId).filter((subgraphId) => isValidUuid(subgraphId)),
      ),
    );

    const fields = fieldsData.map((field) => ({
      typeName: field.typeName,
      fieldName: field.fieldName,
      requestCount: field.requestCount,
      // A subgraph deleted since the requests, or reported by a non-UUID id, has no name, so its counts are left out.
      subgraphs: field.subgraphs.flatMap((subgraph) => {
        const subgraphName = subgraphNames[subgraph.subgraphId];
        return subgraphName === undefined
          ? []
          : [{ subgraphId: subgraph.subgraphId, subgraphName, requestCount: subgraph.requestCount }];
      }),
    }));

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      fields,
      dateRange: {
        start: new Date(startTimestamp * 1000).toISOString(),
        end: new Date(endTimestamp * 1000).toISOString(),
      },
      analyticsRetentionInDays,
    };
  });
}
