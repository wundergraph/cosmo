import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetSubgraphsRequest, GetSubgraphsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SubgraphDTO } from '../../../types/index.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { convertToSubgraphType, enrichLogger, getLogger, handleError } from '../../util.js';

export function getSubgraphs(
  opts: RouterOptions,
  req: GetSubgraphsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    let namespaceId: string | undefined;
    // Namespace is optional, if not provided, we get all the subgraphs
    if (req.namespace) {
      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Could not find namespace ${req.namespace}`,
          },
          graphs: [],
          count: 0,
        };
      }
      namespaceId = namespace.id;
    }

    const namespaceIds: string[] | undefined = namespaceId ? [namespaceId] : undefined;
    const list: SubgraphDTO[] = await repo.list({
      limit: req.limit,
      offset: req.offset,
      namespaceIds,
      query: req.query,
      excludeFeatureSubgraphs: req.excludeFeatureSubgraphs,
      rbac: authContext.rbac,
    });

    const count = await repo.count({
      namespaceIds,
      query: req.query,
      limit: 0,
      offset: 0,
      excludeFeatureSubgraphs: req.excludeFeatureSubgraphs,
      rbac: authContext.rbac,
    });

    return {
      graphs: list.map((g) => ({
        id: g.id,
        name: g.name,
        routingURL: g.routingUrl,
        lastUpdatedAt: g.lastUpdatedAt,
        labels: g.labels,
        createdUserId: g.creatorUserId,
        targetId: g.targetId,
        isEventDrivenGraph: g.isEventDrivenGraph,
        subscriptionUrl: g.subscriptionUrl,
        subscriptionProtocol: g.subscriptionProtocol,
        namespace: g.namespace,
        websocketSubprotocol: g.websocketSubprotocol || '',
        isFeatureSubgraph: g.isFeatureSubgraph,
        type: convertToSubgraphType(g.type),
      })),
      count,
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
