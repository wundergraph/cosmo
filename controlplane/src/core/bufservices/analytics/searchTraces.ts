import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { SearchTracesRequest, SearchTracesResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { findAnalyticsDataset } from '@wundergraph/cosmo-shared';
import type { PlainMessage } from '../../../types/index.js';
import { PublicError } from '../../errors/errors.js';
import { observedSamplingRatio } from '../../repositories/analytics/query/engine.js';
import { REQUESTS_ROOT_SPANS } from '../../repositories/analytics/query/registry.js';
import { validateQuery } from '../../repositories/analytics/query/validate.js';
import {
  clampCursorWindow,
  decodeTraceCursor,
  encodeTraceCursor,
  queryFingerprint,
  QueryValidationError,
  type TraceCursorState,
} from '../../repositories/analytics/query/window.js';
import { TraceSearchRepository } from '../../repositories/analytics/TraceSearchRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enforceAnalyticsRateLimit, isMcpRequest } from '../../services/AnalyticsRateLimiter.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import {
  baseMeta,
  resolveAnalyticsGraphs,
  resolveAnalyticsWindow,
  retentionDays,
  toPredicates,
  toPublicError,
  windowWarnings,
} from './analyticsRequest.js';
import { DEFAULT_ROW_BUDGET } from './queryAnalytics.js';

const MAX_LIMIT = 100;
const OPERATION_FIELDS = new Set(['operationName', 'operationHash']);

const filtersOf = (dataset: 'requests' | 'spans', predicates: SearchTracesRequest['requestFilters']) =>
  validateQuery({
    dataset,
    dimensions: [],
    measures: [],
    filters: toPredicates(predicates),
    having: [],
    orderBy: [],
    includeInactive: false,
  });

const duration = (value: bigint | undefined, name: string) => {
  if (value === undefined) {
    return undefined;
  }
  if (value < 0n) {
    throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, `${name} can't be negative.`);
  }
  return Number(value);
};

export function searchTraces(
  opts: RouterOptions,
  req: SearchTracesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<SearchTracesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<SearchTracesResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return { response: { code: EnumStatusCode.ERR_ANALYTICS_DISABLED }, traces: [] };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader, {
      skipApiKeyUsageUpdate: isMcpRequest(ctx.requestHeader),
    });
    logger = enrichLogger(ctx, logger, authContext);
    await enforceAnalyticsRateLimit(opts, ctx, authContext.organizationId);

    const nowSeconds = Math.floor(Date.now() / 1000);
    try {
      if (!req.graph) {
        throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, 'graph is required.');
      }
      const sort = req.sort || 'timestamp';
      if (sort !== 'timestamp' && sort !== 'duration') {
        throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, 'sort must be "timestamp" or "duration".');
      }
      const limit = req.limit > 0 ? req.limit : 20;
      if (limit > MAX_LIMIT) {
        throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, `limit is at most ${MAX_LIMIT}.`);
      }

      const requests = filtersOf('requests', req.requestFilters);
      const spanConditions = req.spanConditions.map((condition, index) => {
        if (
          condition.spanName === undefined &&
          condition.subgraphName === undefined &&
          condition.minDurationNs === undefined &&
          condition.maxDurationNs === undefined &&
          condition.hasError === undefined &&
          condition.attributes.length === 0
        ) {
          throw new QueryValidationError(`Span condition ${index + 1} has no criteria.`);
        }
        return {
          spanName: condition.spanName,
          spanNamePrefix: condition.spanNamePrefix,
          subgraphName: condition.subgraphName,
          minDurationNs: duration(condition.minDurationNs, 'minDurationNs'),
          maxDurationNs: duration(condition.maxDurationNs, 'maxDurationNs'),
          hasError: condition.hasError,
          attributes: filtersOf('spans', condition.attributes).filters,
        };
      });

      const [graph] = await resolveAnalyticsGraphs({
        opts,
        logger,
        authContext,
        graphs: [req.graph],
        allReadableGraphs: false,
      });
      const descriptor = findAnalyticsDataset(spanConditions.length > 0 ? 'spans' : 'requests')!;
      const retention = await retentionDays({
        opts,
        logger,
        organizationId: authContext.organizationId,
        feature: 'tracing-retention',
        storageTtlDays: descriptor.storageTtlDays,
      });
      let resolved = resolveAnalyticsWindow({ window: req.window, descriptor, retentionDays: retention, nowSeconds });

      const fingerprint = queryFingerprint({ ...req, cursor: undefined, window: undefined, graph: graph.id });
      let cursor: TraceCursorState | undefined;
      if (req.cursor) {
        cursor = decodeTraceCursor(req.cursor, fingerprint);
        resolved = {
          ...resolved,
          effective: clampCursorWindow(cursor, { retentionDays: retention, nowSeconds, grainSeconds: 1 }),
        };
      }

      const repo = new TraceSearchRepository(opts.chClient, opts.analyticsQueryRowBudget ?? DEFAULT_ROW_BUDGET);
      const result = await repo.search({
        organizationId: authContext.organizationId,
        graphId: graph.id,
        window: resolved.effective,
        requestFilters: requests.filters.filter((f) => !OPERATION_FIELDS.has(f.field)),
        operationFilters: requests.filters.filter((f) => OPERATION_FIELDS.has(f.field)),
        needsRootSpans: requests.physical === REQUESTS_ROOT_SPANS,
        spanConditions,
        minDurationNs: duration(req.minDurationNs, 'minDurationNs'),
        maxDurationNs: duration(req.maxDurationNs, 'maxDurationNs'),
        hasError: req.hasError,
        sort,
        limit,
        cursor: cursor ? { value: cursor.value, traceId: cursor.traceId } : undefined,
      });

      const last = result.traces.at(-1);
      const sampling = await observedSamplingRatio(
        opts.chClient,
        {
          organizationId: authContext.organizationId,
          graphs: [graph],
          window: resolved.effective,
          retentionStart: nowSeconds - retention * 86_400,
        },
        opts.analyticsQueryRowBudget ?? DEFAULT_ROW_BUDGET,
      );
      return {
        response: { code: EnumStatusCode.OK },
        traces: result.traces.map((trace) => ({
          traceId: trace.traceId,
          spanId: trace.spanId,
          timestamp: trace.timestamp,
          durationNs: trace.durationNs,
          operationName: trace.operationName,
          operationType: trace.operationType,
          operationHash: trace.operationHash,
          operationPersistedId: trace.operationPersistedId,
          clientName: trace.clientName,
          clientVersion: trace.clientVersion,
          httpStatusCode: trace.httpStatusCode,
          statusMessage: trace.statusMessage,
          hasError: trace.hasError,
          matchedSpans: trace.matchedSpans,
          sortDurationNs: trace.sortDurationNs,
        })),
        meta: {
          ...baseMeta({ descriptor: findAnalyticsDataset(result.source)!, resolved, graphs: [graph], nowSeconds }),
          observedSamplingRatio: sampling.ratio,
          truncated: result.truncated,
          nextCursor:
            result.truncated && last
              ? encodeTraceCursor({ value: last.sortValue, traceId: last.traceId, ...resolved.effective, fingerprint })
              : undefined,
          warnings: [
            ...windowWarnings(resolved, retention, 'tracing-retention', nowSeconds),
            ...(sampling.warning ? [sampling.warning] : []),
          ],
          tables: result.tables,
        },
      };
    } catch (error) {
      throw toPublicError(error);
    }
  });
}
