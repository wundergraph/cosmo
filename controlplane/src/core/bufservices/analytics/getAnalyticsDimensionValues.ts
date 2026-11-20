import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAnalyticsDimensionValuesRequest,
  GetAnalyticsDimensionValuesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { FeatureIds, PlainMessage } from '../../../types/index.js';
import { PublicError } from '../../errors/errors.js';
import { AnalyticsQueryEngine, applyGraphFilter } from '../../repositories/analytics/query/engine.js';
import { PostgresAnalyticsInventory } from '../../repositories/analytics/query/inventory.js';
import { HIDDEN_DIMENSIONS } from '../../repositories/analytics/query/registry.js';
import { validateDimensionValuesTarget, validateQuery } from '../../repositories/analytics/query/validate.js';
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

const MAX_VALUES = 1000;

export function getAnalyticsDimensionValues(
  opts: RouterOptions,
  req: GetAnalyticsDimensionValuesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAnalyticsDimensionValuesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAnalyticsDimensionValuesResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return { response: { code: EnumStatusCode.ERR_ANALYTICS_DISABLED }, values: [] };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader, {
      skipApiKeyUsageUpdate: isMcpRequest(ctx.requestHeader),
    });
    logger = enrichLogger(ctx, logger, authContext);
    await enforceAnalyticsRateLimit(opts, ctx, authContext.organizationId);

    const nowSeconds = Math.floor(Date.now() / 1000);
    try {
      const { descriptor } = validateDimensionValuesTarget(req.dataset, req.dimension);
      // Validates the filters (and, for public dimensions, that the dimension groups) like QueryAnalytics does.
      const query = validateQuery({
        dataset: req.dataset,
        dimensions: HIDDEN_DIMENSIONS.has(req.dimension) ? [] : [req.dimension],
        measures: [],
        filters: toPredicates(req.filters),
        having: [],
        orderBy: [],
        includeInactive: false,
      });
      if (HIDDEN_DIMENSIONS.has(req.dimension)) {
        query.physical = validateDimensionValuesTarget(req.dataset, req.dimension).physical;
      }
      const limit = req.limit > 0 ? req.limit : 50;
      if (limit > MAX_VALUES) {
        throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, `limit is at most ${MAX_VALUES}.`);
      }

      // Graph filters narrow the graphs themselves, as in QueryAnalytics.
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
      const feature = descriptor.retentionFeature as FeatureIds;
      const retention = await retentionDays({
        opts,
        logger,
        organizationId: authContext.organizationId,
        feature,
        storageTtlDays: descriptor.storageTtlDays,
      });
      const resolved = resolveAnalyticsWindow({ window: req.window, descriptor, retentionDays: retention, nowSeconds });
      if (graphs.length === 0) {
        return {
          response: { code: EnumStatusCode.OK },
          values: [],
          meta: {
            ...baseMeta({ descriptor, resolved, graphs, nowSeconds }),
            warnings: ['No graph matches the graph filter.'],
          },
        };
      }

      const engine = new AnalyticsQueryEngine(
        opts.chClient,
        new PostgresAnalyticsInventory(opts.db, authContext.organizationId),
        { rowBudget: opts.analyticsQueryRowBudget ?? DEFAULT_ROW_BUDGET },
      );
      const result = await engine.dimensionValues({
        query,
        dimension: req.dimension,
        prefix: req.prefix,
        scope: {
          organizationId: authContext.organizationId,
          graphs,
          window: resolved.effective,
          retentionStart: nowSeconds - retention * 86_400,
        },
        limit,
      });

      return {
        response: { code: EnumStatusCode.OK },
        values: result.values.map((entry) => ({ value: entry.value, count: BigInt(Math.round(entry.count)) })),
        meta: {
          ...baseMeta({ descriptor, resolved, graphs, nowSeconds }),
          truncated: result.values.length >= limit,
          warnings: windowWarnings(resolved, retention, feature, nowSeconds),
        },
      };
    } catch (error) {
      throw toPublicError(error);
    }
  });
}
