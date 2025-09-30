import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureSubgraphsByFeatureFlagRequest,
  GetFeatureSubgraphsByFeatureFlagResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFeatureSubgraphsByFeatureFlag(
  opts: RouterOptions,
  req: GetFeatureSubgraphsByFeatureFlagRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureSubgraphsByFeatureFlagResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureSubgraphsByFeatureFlagResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find namespace ${req.namespace}`,
        },
        featureSubgraphs: [],
      };
    }

    const featureFlag = await featureFlagRepo.getFeatureFlagByName({
      namespaceId: namespace.id,
      featureFlagName: req.featureFlagName,
    });

    if (!featureFlag) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find feature flag ${req.featureFlagName}`,
        },
        featureSubgraphs: [],
      };
    }

    if (!authContext.rbac.hasFeatureFlagReadAccess(featureFlag)) {
      throw new UnauthorizedError();
    }

    const featureSubgraphs = await featureFlagRepo.getFeatureSubgraphsByFeatureFlagId({
      namespaceId: namespace.id,
      featureFlagId: featureFlag.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      featureSubgraphs: featureSubgraphs.map((f) => ({
        id: f.id,
        name: f.name,
        routingURL: f.routingUrl,
        lastUpdatedAt: f.lastUpdatedAt,
        labels: f.labels,
        createdUserId: f.creatorUserId,
        targetId: f.targetId,
        isEventDrivenGraph: f.isEventDrivenGraph,
        subscriptionUrl: f.subscriptionUrl,
        subscriptionProtocol: f.subscriptionProtocol,
        namespace: f.namespace,
        websocketSubprotocol: f.websocketSubprotocol || '',
        isFeatureSubgraph: f.isFeatureSubgraph,
        baseSubgraphName: f.baseSubgraphName,
        baseSubgraphId: f.baseSubgraphId,
      })),
    };
  });
}
