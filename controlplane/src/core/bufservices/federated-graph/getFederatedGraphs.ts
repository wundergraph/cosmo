import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFederatedGraphsRequest,
  GetFederatedGraphsResponse,
  RequestSeriesItem,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { subHours } from 'date-fns';
import { FederatedGraphDTO } from '../../../types/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { AnalyticsDashboardViewRepository } from '../../repositories/analytics/AnalyticsDashboardViewRepository.js';
import { parseTimeFilters } from '../../repositories/analytics/util.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getFederatedGraphs(
  opts: RouterOptions,
  req: GetFederatedGraphsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFederatedGraphsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFederatedGraphsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    let namespaceId: string | undefined;
    // Namespace is optional, if not provided, we get all the federated graphs
    if (req.namespace) {
      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Could not find namespace ${req.namespace}`,
          },
          graphs: [],
        };
      }
      namespaceId = namespace.id;
    }

    const list: FederatedGraphDTO[] = await fedGraphRepo.list({
      limit: req.limit,
      offset: req.offset,
      namespaceIds: namespaceId ? [namespaceId] : undefined,
      supportsFederation: req.supportsFederation,
      rbac: authContext.rbac,
    });

    const requestSeriesList: Record<string, PlainMessage<RequestSeriesItem>[]> = {};

    const { dateRange } = parseTimeFilters({
      start: subHours(new Date(), 4).toString(),
      end: new Date().toString(),
    });

    if (req.includeMetrics && opts.chClient) {
      const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);

      await Promise.all(
        list.map(async (g) => {
          const requestSeries = await analyticsDashRepo.getRequestSeries(g.id, authContext.organizationId, {
            granule: '5',
            dateRange,
          });
          requestSeriesList[g.id] = [];
          requestSeriesList[g.id].push(...requestSeries);
        }),
      );
    }

    return {
      graphs: list.map((g) => ({
        id: g.id,
        targetId: g.targetId,
        name: g.name,
        namespace: g.namespace,
        labelMatchers: g.labelMatchers,
        routingURL: g.routingUrl,
        lastUpdatedAt: g.lastUpdatedAt,
        connectedSubgraphs: g.subgraphsCount,
        compositionErrors: g.compositionErrors ?? '',
        isComposable: g.isComposable,
        compositionId: g.compositionId,
        requestSeries: requestSeriesList[g.id] ?? [],
        supportsFederation: g.supportsFederation,
        contract: g.contract,
        admissionWebhookUrl: g.admissionWebhookURL,
        routerCompatibilityVersion: g.routerCompatibilityVersion,
      })),
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
