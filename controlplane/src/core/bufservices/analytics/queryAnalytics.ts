import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { QueryAnalyticsRequest, QueryAnalyticsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { FeatureIds, PlainMessage } from '../../../types/index.js';
import { AnalyticsQueryEngine, applyGraphFilter } from '../../repositories/analytics/query/engine.js';
import { PostgresAnalyticsInventory } from '../../repositories/analytics/query/inventory.js';
import { validateQuery } from '../../repositories/analytics/query/validate.js';
import {
  clampCursorWindow,
  decodeCursor,
  encodeCursor,
  GRAIN_SECONDS,
  queryFingerprint,
} from '../../repositories/analytics/query/window.js';
import type { RouterOptions } from '../../routes.js';
import { enforceAnalyticsRateLimit, isMcpRequest } from '../../services/AnalyticsRateLimiter.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import {
  baseMeta,
  dateRange,
  operatorName,
  resolveAnalyticsGraphs,
  resolveAnalyticsWindow,
  retentionDays,
  toPredicates,
  toPublicError,
  toRowValue,
  windowWarnings,
} from './analyticsRequest.js';

export function queryAnalytics(
  opts: RouterOptions,
  req: QueryAnalyticsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<QueryAnalyticsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<QueryAnalyticsResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return { response: { code: EnumStatusCode.ERR_ANALYTICS_DISABLED }, rows: [], columns: [] };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader, {
      skipApiKeyUsageUpdate: isMcpRequest(ctx.requestHeader),
    });
    logger = enrichLogger(ctx, logger, authContext);
    await enforceAnalyticsRateLimit(opts, ctx, authContext.organizationId);

    const nowSeconds = Math.floor(Date.now() / 1000);
    try {
      const query = validateQuery({
        dataset: req.dataset,
        dimensions: req.dimensions,
        measures: req.measures,
        filters: toPredicates(req.filters),
        having: req.having.map((h) => ({ measure: h.measure, operator: operatorName(h.operator), value: h.value })),
        timeBucket: req.timeBucket,
        orderBy: req.orderBy.map((sort) => ({ field: sort.field, desc: sort.desc })),
        limit: req.limit,
        includeInactive: req.includeInactive,
        compare: req.compare
          ? {
              previousPeriod: req.compare.previousPeriod,
              baselineStart: req.compare.baselineStart,
              baselineEnd: req.compare.baselineEnd,
              minVolume: req.compare.minVolume,
            }
          : undefined,
      });

      // Graph filters narrow the graphs themselves; other filters reach the SQL.
      const graphs = applyGraphFilter(
        await resolveAnalyticsGraphs({
          opts,
          logger,
          authContext,
          graphs: req.graphs,
          allReadableGraphs: req.allReadableGraphs,
        }),
        query.filters,
      );

      const feature = query.descriptor.retentionFeature as FeatureIds;
      const retention = await retentionDays({
        opts,
        logger,
        organizationId: authContext.organizationId,
        feature,
        storageTtlDays: query.descriptor.storageTtlDays,
      });
      const fingerprint = queryFingerprint({
        ...req,
        cursor: undefined,
        window: undefined,
        graphs: graphs.map((g) => g.id),
      });
      let resolved = resolveAnalyticsWindow({
        window: req.window,
        descriptor: query.descriptor,
        retentionDays: retention,
        nowSeconds,
        // Documents are searched across the whole retention unless a window is given.
        defaultRangeHours: query.descriptor.name === 'operation_documents' ? retention * 24 : 24,
      });
      let offset = 0;
      if (req.cursor) {
        const state = decodeCursor(req.cursor, fingerprint);
        offset = state.offset;
        resolved = {
          ...resolved,
          effective: clampCursorWindow(state, {
            retentionDays: retention,
            nowSeconds,
            grainSeconds: GRAIN_SECONDS[query.descriptor.grain] ?? 1,
          }),
        };
      }

      const meta = baseMeta({
        descriptor: query.descriptor,
        resolved,
        graphs,
        nowSeconds,
        granularity: query.timeBucket,
      });
      if (graphs.length === 0) {
        return {
          response: { code: EnumStatusCode.OK },
          rows: [],
          columns: [],
          meta: { ...meta, warnings: ['No graph matches the graph filter.'] },
        };
      }

      const engine = new AnalyticsQueryEngine(
        opts.chClient,
        new PostgresAnalyticsInventory(opts.db, authContext.organizationId),
        { rowBudget: opts.analyticsQueryRowBudget ?? DEFAULT_ROW_BUDGET },
      );
      const result = await engine.run(
        query,
        {
          organizationId: authContext.organizationId,
          graphs,
          window: resolved.effective,
          retentionStart: nowSeconds - retention * 86_400,
        },
        offset,
      );

      const nextOffset = offset + query.limit;
      return {
        response: { code: EnumStatusCode.OK },
        columns: result.columns,
        rows: result.rows.map((row) => ({
          value: Object.fromEntries(result.columns.map((column) => [column, toRowValue(row[column] ?? null)])),
        })),
        meta: {
          ...meta,
          observedSamplingRatio: result.observedSamplingRatio,
          truncated: result.truncated,
          nextCursor: result.truncated
            ? encodeCursor({ offset: nextOffset, ...resolved.effective, fingerprint })
            : undefined,
          warnings: [...windowWarnings(resolved, retention, feature, nowSeconds), ...result.warnings],
          tables: req.explain ? result.tables : [],
          appliedFilters: req.explain ? result.appliedFilters : [],
          baselineWindow: result.baselineWindow ? dateRange(result.baselineWindow) : undefined,
        },
      };
    } catch (error) {
      throw toPublicError(error);
    }
  });
}

/** Rows a sampled-data query may plan to read (EXPLAIN ESTIMATE) before it is refused. */
export const DEFAULT_ROW_BUDGET = 200_000_000;
