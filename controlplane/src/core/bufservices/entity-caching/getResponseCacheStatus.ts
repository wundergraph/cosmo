import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetResponseCacheStatusRequest,
  GetResponseCacheStatusResponse,
  ResponseCacheStatus,
  SubgraphResponseCacheStatus,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage } from '../../../types/index.js';
import { deafultRangeInHoursForGetOperations } from '../../constants.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { getDateRange, isoDateRangeToTimestamps } from '../../repositories/analytics/util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateDateRanges } from '../../util.js';

export function getResponseCacheStatus(
  opts: RouterOptions,
  req: GetResponseCacheStatusRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetResponseCacheStatusResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetResponseCacheStatusResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        coverageCount: 0,
        subgraphs: [],
      };
    }

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const orgRepo = new OrganizationRepository(logger, opts.db, opts.billingDefaultPlanId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        coverageCount: 0,
        subgraphs: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    // Use provided range/dateRange or fall back to default
    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const { range, dateRange } = validateDateRanges({
      limit: analyticsRetention?.limit ?? 7,
      range: req.dateRange ? undefined : deafultRangeInHoursForGetOperations,
      dateRange: req.dateRange,
    });

    if (!range && !dateRange) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        coverageCount: 0,
        subgraphs: [],
      };
    }

    const [start, end] = getDateRange(isoDateRangeToTimestamps(dateRange, range));

    // The table is a SummingMergeTree, so one key can span several rows until the engine merges them: always sum.
    const rows = await opts.chClient.queryPromise<{
      subgraphId: string;
      cacheStatus: string;
      totalFetches: string;
      nonDeltaPoints: string;
    }>(
      `
      SELECT
        SubgraphID AS subgraphId,
        CacheStatus AS cacheStatus,
        sum(TotalFetches) AS totalFetches,
        sum(NonDeltaPoints) AS nonDeltaPoints
      FROM ${opts.chClient.database}.subgraph_response_cache_status_5_30
      WHERE Timestamp >= toDateTime({start:UInt32})
        AND Timestamp <= toDateTime({end:UInt32})
        AND OrganizationID = {organizationId:String}
        AND FederatedGraphID = {federatedGraphId:String}
      GROUP BY SubgraphID, CacheStatus
      ORDER BY SubgraphID, CacheStatus
      `,
      {
        start,
        end,
        organizationId: authContext.organizationId,
        federatedGraphId: graph.id,
      },
    );

    const subgraphsForFedGraph = await subgraphRepo.listByFederatedGraph({ federatedGraphTargetId: graph.targetId });
    const subgraphNames = new Map(subgraphsForFedGraph.map((s) => [s.id, s.name]));

    const bySubgraph = new Map<string, PlainMessage<SubgraphResponseCacheStatus>>();
    for (const row of rows ?? []) {
      let subgraph = bySubgraph.get(row.subgraphId);
      if (!subgraph) {
        subgraph = {
          subgraphId: row.subgraphId,
          subgraphName: subgraphNames.get(row.subgraphId) ?? '',
          totalFetches: BigInt(0),
          nonDeltaPoints: BigInt(0),
          statuses: [],
        };

        bySubgraph.set(row.subgraphId, subgraph);
      }

      const totalFetches = BigInt(row.totalFetches);
      subgraph.totalFetches += totalFetches;
      subgraph.nonDeltaPoints += BigInt(row.nonDeltaPoints);
      subgraph.statuses.push({ cacheStatus: getCacheStatus(row.cacheStatus), totalFetches });
    }

    // Leave a subgraph out only when both counts are zero. Zero fetches with non delta points above zero is kept:
    // that is a router exporting cumulative metrics, and the caller has to be able to tell it apart from no traffic.
    const subgraphs = [...bySubgraph.values()].filter(
      (s) => s.totalFetches > BigInt(0) || s.nonDeltaPoints > BigInt(0),
    );

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      interval: {
        start: new Date(start * 1000).toISOString(),
        end: new Date(end * 1000).toISOString(),
      },
      coverageCount: subgraphs.length,
      subgraphs,
    };
  });
}

function getCacheStatus(status: string): ResponseCacheStatus {
  switch (status) {
    case 'hit': {
      return ResponseCacheStatus.HIT;
    }
  }

  return ResponseCacheStatus.MISS;
}
