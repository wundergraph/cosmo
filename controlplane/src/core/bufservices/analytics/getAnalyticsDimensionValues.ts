import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAnalyticsDimensionValuesRequest,
  GetAnalyticsDimensionValuesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { PublicError } from '../../errors/errors.js';
import { validateDimensionValuesQuery } from '../../repositories/analytics/query/validate.js';
import type { RouterOptions } from '../../routes.js';
import { authenticateAnalyticsRead } from '../../util/analytics/auth.js';
import { baseMeta, toPredicates, toPublicError, windowWarnings } from '../../util/analytics/proto.js';
import { createAnalyticsEngine, resolveAnalyticsScope, toEngineScope } from '../../util/analytics/scope.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

const MAX_VALUES = 1000;

export function getAnalyticsDimensionValues(
  opts: RouterOptions,
  req: GetAnalyticsDimensionValuesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAnalyticsDimensionValuesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAnalyticsDimensionValuesResponse>>(ctx, logger, async () => {
    const chClient = opts.chClient;
    if (!chClient) {
      return { response: { code: EnumStatusCode.ERR_ANALYTICS_DISABLED }, values: [] };
    }
    const authContext = await authenticateAnalyticsRead(opts, ctx);
    logger = enrichLogger(ctx, logger, authContext);

    const nowSeconds = Math.floor(Date.now() / 1000);
    try {
      const query = validateDimensionValuesQuery({
        dataset: req.dataset,
        dimension: req.dimension,
        filters: toPredicates(req.filters),
      });
      const limit = req.limit > 0 ? req.limit : 50;
      if (limit > MAX_VALUES) {
        throw new PublicError(EnumStatusCode.ERR_BAD_REQUEST, `limit is at most ${MAX_VALUES}.`);
      }

      const scope = await resolveAnalyticsScope({
        opts,
        logger,
        authContext,
        graphs: req.graphs,
        allReadableGraphs: req.allReadableGraphs,
        filters: query.filters,
        descriptor: query.descriptor,
        window: req.window,
        nowSeconds,
      });
      const { descriptor } = query;
      const meta = {
        ...baseMeta({ descriptor, resolved: scope.resolved, graphs: scope.graphs, nowSeconds }),
        warnings: windowWarnings(scope.resolved, scope.retentionDays, descriptor.retentionFeature, nowSeconds),
      };
      if (scope.graphs.length === 0) {
        return {
          response: { code: EnumStatusCode.OK },
          values: [],
          meta: { ...meta, warnings: ['No graph matches the graph filter.'] },
        };
      }

      const result = await createAnalyticsEngine(opts, chClient, authContext.organizationId).dimensionValues({
        query,
        dimension: req.dimension,
        prefix: req.prefix,
        scope: toEngineScope(authContext.organizationId, scope, scope.resolved.effective, nowSeconds),
        limit,
      });

      return {
        response: { code: EnumStatusCode.OK },
        values: result.values.map((entry) => ({ value: entry.value, count: BigInt(Math.round(entry.count)) })),
        meta: { ...meta, truncated: result.values.length >= limit },
      };
    } catch (error) {
      throw toPublicError(error);
    }
  });
}
