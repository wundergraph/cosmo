import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOrganizationRequestsCountRequest,
  MonthlyRequestCount,
  GetOrganizationRequestsCountResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { MonthlyRequestViewRepository } from '../../repositories/analytics/MonthlyRequestViewRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { PlainMessage } from '../../../types/index.js';
import { authenticateAnalyticsRead } from '../../util/analytics/auth.js';

export function getOrganizationRequestsCount(
  opts: RouterOptions,
  req: GetOrganizationRequestsCountRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetOrganizationRequestsCountResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOrganizationRequestsCountResponse>>(ctx, logger, async () => {
    const authContext = await authenticateAnalyticsRead(opts, ctx);
    logger = enrichLogger(ctx, logger, authContext);

    if (!authContext.rbac.isOrganizationAdmin) {
      throw new UnauthorizedError();
    }

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        count: BigInt(0),
        history: [],
      };
    }
    const monthlyRequestsRepo = new MonthlyRequestViewRepository(opts.chClient);
    const count = await monthlyRequestsRepo.getMonthlyRequestCount(authContext.organizationId);

    const history: PlainMessage<MonthlyRequestCount>[] = [];
    if (req.months !== undefined) {
      const months = Math.min(Math.max(req.months, 1), 3);
      const rows = await monthlyRequestsRepo.getMonthlyRequestCountsByGraph(authContext.organizationId, months);
      const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
      const graphs = new Map(
        (await fedGraphRepo.list({ limit: 0, offset: 0, rbac: authContext.rbac })).map((graph) => [graph.id, graph]),
      );

      for (const row of rows) {
        const month = row.month.slice(0, 7);
        let entry = history.find((h) => h.month === month);
        if (!entry) {
          entry = { month, count: BigInt(0), graphs: [] };
          history.push(entry);
        }
        entry.count += BigInt(row.count);

        const graph = graphs.get(row.federatedGraphId);
        if (graph) {
          entry.graphs.push({
            federatedGraphId: graph.id,
            name: graph.name,
            namespace: graph.namespace,
            count: BigInt(row.count),
            deleted: false,
          });
          continue;
        }
        // Graphs deleted since: one remainder per month, so per-graph counts still add up to the total.
        const remainder = entry.graphs.find((g) => g.deleted);
        if (remainder) {
          remainder.count += BigInt(row.count);
        } else {
          entry.graphs.push({ federatedGraphId: '', name: '', namespace: '', count: BigInt(row.count), deleted: true });
        }
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      count: BigInt(count),
      history,
    };
  });
}
