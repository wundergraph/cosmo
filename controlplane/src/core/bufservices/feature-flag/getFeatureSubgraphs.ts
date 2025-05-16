import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureSubgraphsRequest,
  GetFeatureSubgraphsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getFeatureSubgraphs(
  opts: RouterOptions,
  req: GetFeatureSubgraphsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureSubgraphsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureSubgraphsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    let namespaceId: string | undefined;
    // Namespace is optional, if not provided, we get all the feature subgraphs
    if (req.namespace) {
      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Could not find namespace ${req.namespace}`,
          },
          featureSubgraphs: [],
          count: 0,
        };
      }
      namespaceId = namespace.id;
    }

    const list = await featureFlagRepo.getFeatureSubgraphs({
      limit: req.limit,
      offset: req.offset,
      namespaceId,
      query: req.query,
      rbac: authContext.rbac,
    });

    const count = await featureFlagRepo.getFeatureSubgraphsCount({
      namespaceId,
      query: req.query,
      limit: 0,
      offset: 0,
      rbac: authContext.rbac,
    });

    return {
      featureSubgraphs: list.map((g) => ({
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
        baseSubgraphName: g.baseSubgraphName,
        baseSubgraphId: g.baseSubgraphId,
      })),
      count,
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
