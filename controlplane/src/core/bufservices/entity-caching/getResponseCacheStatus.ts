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

const BUCKET_SECONDS = 5 * 60;

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

    // An explicit range that does not parse must fail, not silently fall back to the default range.
    if (
      req.dateRange &&
      (Number.isNaN(Date.parse(req.dateRange.start)) || Number.isNaN(Date.parse(req.dateRange.end)))
    ) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'Invalid date range',
        },
        coverageCount: 0,
        subgraphs: [],
      };
    }

    // Use provided range/dateRange or fall back to default
    const analyticsRetention = await orgRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'analytics-retention',
    });

    const retentionDays = analyticsRetention?.limit ?? 7;
    const retentionCutoff = Math.floor((Date.now() - retentionDays * 24 * 60 * 60 * 1000) / 1000);
    const { range, dateRange } = validateDateRanges({
      limit: retentionDays,
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

    const [requestedStart, requestedEnd] = getDateRange(isoDateRangeToTimestamps(dateRange, range));
    // Rounding the start down must not reach before the retention cutoff, so round it up there instead.
    let start = Math.floor(requestedStart / BUCKET_SECONDS) * BUCKET_SECONDS;
    if (start < retentionCutoff) {
      start = Math.ceil(requestedStart / BUCKET_SECONDS) * BUCKET_SECONDS;
    }
    const end = Math.max(start, Math.ceil(requestedEnd / BUCKET_SECONDS) * BUCKET_SECONDS);

    // The table is a SummingMergeTree, so one key can span several rows until the engine merges them: always sum.
    // The inner query sums each bucket and drops buckets with no data, so coverageCount counts only the buckets in
    // which a subgraph was observed, once each, across all of its cache statuses.
    const rows = await opts.chClient.queryPromise<{
      subgraphId: string;
      cacheStatus: string;
      totalFetches: string;
      nonDeltaPoints: string;
      coverageCount: string;
    }>(
      `
      SELECT
        subgraphId,
        cacheStatus,
        sum(bucketFetches) AS totalFetches,
        sum(bucketNonDeltaPoints) AS nonDeltaPoints,
        any(subgraphBuckets) AS coverageCount
      FROM (
        SELECT
          SubgraphID AS subgraphId,
          CacheStatus AS cacheStatus,
          sum(TotalFetches) AS bucketFetches,
          sum(NonDeltaPoints) AS bucketNonDeltaPoints,
          uniqExact(Timestamp) OVER (PARTITION BY SubgraphID) AS subgraphBuckets
        FROM ${opts.chClient.database}.subgraph_response_cache_status_5_30
        WHERE Timestamp >= toDateTime({start:UInt32})
          AND Timestamp < toDateTime({end:UInt32})
          AND OrganizationID = {organizationId:String}
          AND FederatedGraphID = {federatedGraphId:String}
        GROUP BY SubgraphID, CacheStatus, Timestamp
        HAVING bucketFetches > 0 OR bucketNonDeltaPoints > 0
      )
      GROUP BY subgraphId, cacheStatus
      ORDER BY subgraphId, cacheStatus
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
          coverageCount: Number(row.coverageCount),
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
  switch (status.toUpperCase()) {
    case 'HIT': {
      return ResponseCacheStatus.HIT;
    }
    case 'PARTIAL_HIT': {
      return ResponseCacheStatus.PARTIAL_HIT;
    }
    case 'NOT_CACHEABLE': {
      return ResponseCacheStatus.NOT_CACHEABLE;
    }
    case 'MISS': {
      return ResponseCacheStatus.MISS;
    }
  }

  return ResponseCacheStatus.UNKNOWN;
}
