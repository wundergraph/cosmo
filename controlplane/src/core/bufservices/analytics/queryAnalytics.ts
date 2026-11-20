import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { QueryAnalyticsRequest, QueryAnalyticsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { validateQuery } from '../../repositories/analytics/query/validate.js';
import { grainSecondsOf } from '../../repositories/analytics/query/window.js';
import type { RouterOptions } from '../../routes.js';
import { authenticateAnalyticsRead } from '../../util/analytics/auth.js';
import { clampCursorWindow, decodeCursor, encodeCursor, queryFingerprint } from '../../util/analytics/cursor.js';
import {
  baseMeta,
  dateRange,
  operatorName,
  toPredicates,
  toPublicError,
  toRowValue,
  windowWarnings,
} from '../../util/analytics/proto.js';
import { createAnalyticsEngine, resolveAnalyticsScope, toEngineScope } from '../../util/analytics/scope.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function queryAnalytics(
  opts: RouterOptions,
  req: QueryAnalyticsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<QueryAnalyticsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<QueryAnalyticsResponse>>(ctx, logger, async () => {
    const chClient = opts.chClient;
    if (!chClient) {
      return { response: { code: EnumStatusCode.ERR_ANALYTICS_DISABLED }, rows: [], columns: [] };
    }
    const authContext = await authenticateAnalyticsRead(opts, ctx);
    logger = enrichLogger(ctx, logger, authContext);

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
      const { descriptor, filters, timeBucket, limit } = query;

      const scope = await resolveAnalyticsScope({
        opts,
        logger,
        authContext,
        graphs: req.graphs,
        allReadableGraphs: req.allReadableGraphs,
        filters,
        descriptor,
        window: req.window,
        nowSeconds,
        // Documents are searched across the whole retention unless a window is given.
        defaultRangeHours: (retention) => (descriptor.name === 'operation_documents' ? retention * 24 : 24),
      });
      const { graphs, retentionDays } = scope;
      const fingerprint = queryFingerprint({
        ...req,
        cursor: undefined,
        window: undefined,
        graphs: graphs.map((g) => g.id),
      });
      let { resolved } = scope;
      let offset = 0;
      if (req.cursor) {
        const state = decodeCursor(req.cursor, fingerprint);
        offset = state.offset;
        resolved = {
          ...resolved,
          effective: clampCursorWindow(state, {
            retentionDays,
            nowSeconds,
            grainSeconds: grainSecondsOf(descriptor.grain),
          }),
        };
      }

      const meta = baseMeta({ descriptor, resolved, graphs, nowSeconds, granularity: timeBucket });
      if (graphs.length === 0) {
        return {
          response: { code: EnumStatusCode.OK },
          rows: [],
          columns: [],
          meta: { ...meta, warnings: ['No graph matches the graph filter.'] },
        };
      }

      const result = await createAnalyticsEngine(opts, chClient, authContext.organizationId).run(
        query,
        toEngineScope(authContext.organizationId, scope, resolved.effective, nowSeconds),
        offset,
      );

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
            ? encodeCursor({ offset: offset + limit, ...resolved.effective, fingerprint })
            : undefined,
          warnings: [
            ...windowWarnings(resolved, retentionDays, descriptor.retentionFeature, nowSeconds),
            ...result.warnings,
          ],
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
