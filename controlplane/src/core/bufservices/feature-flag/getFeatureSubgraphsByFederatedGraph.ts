import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureSubgraphsByFederatedGraphRequest,
  GetFeatureSubgraphsByFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { convertToSubgraphType, enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFeatureSubgraphsByFederatedGraph(
  opts: RouterOptions,
  req: GetFeatureSubgraphsByFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureSubgraphsByFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureSubgraphsByFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace ${req.namespace} not found`,
        },
        featureSubgraphs: [],
        totalCount: 0,
      };
    }

    const federatedGraph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated Graph '${req.federatedGraphName}' not found`,
        },
        featureSubgraphs: [],
        totalCount: 0,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const { featureSubgraphs, totalCount } = await featureFlagRepo.getFeatureSubgraphsByFederatedGraph({
      federatedGraphId: federatedGraph.id,
      namespaceId: namespace.id,
      fedGraphLabelMatchers: federatedGraph.labelMatchers,
      limit: req.limit,
      offset: req.offset,
      query: req.query || undefined,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      featureSubgraphs: featureSubgraphs.map((fs) => ({
        id: fs.id,
        name: fs.name,
        routingURL: fs.routingUrl,
        lastUpdatedAt: fs.lastUpdatedAt,
        labels: fs.labels,
        targetId: fs.targetId,
        creatorUserId: fs.creatorUserId,
        subscriptionUrl: fs.subscriptionUrl,
        namespace: fs.namespace,
        subscriptionProtocol: fs.subscriptionProtocol,
        isEventDrivenGraph: fs.isEventDrivenGraph,
        isV2Graph: fs.isV2Graph,
        websocketSubprotocol: fs.websocketSubprotocol || '',
        isFeatureSubgraph: fs.isFeatureSubgraph,
        baseSubgraphId: fs.baseSubgraphId,
        baseSubgraphName: fs.baseSubgraphName,
        type: convertToSubgraphType(fs.type),
      })),
      totalCount,
    };
  });
}
