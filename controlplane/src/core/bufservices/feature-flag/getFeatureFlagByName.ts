import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureFlagByNameRequest,
  GetFeatureFlagByNameResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFeatureFlagByName(
  opts: RouterOptions,
  req: GetFeatureFlagByNameRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureFlagByNameResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureFlagByNameResponse>>(ctx, logger, async () => {
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
          details: `Could not find namespace ${req.namespace}`,
        },
        featureSubgraphs: [],
        federatedGraphs: [],
      };
    }

    const featureFlag = await featureFlagRepo.getFeatureFlagByName({
      namespaceId: namespace.id,
      featureFlagName: req.name,
    });

    if (!featureFlag) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not find feature flag ${req.name}`,
        },
        featureSubgraphs: [],
        federatedGraphs: [],
      };
    }

    if (!authContext.rbac.hasFeatureFlagReadAccess(featureFlag)) {
      throw new UnauthorizedError();
    }

    // gets all federated graphs that match the feature flag labels
    const labelMatchedFederatedGraphs = await fedGraphRepo.bySubgraphLabels({
      namespaceId: namespace.id,
      labels: featureFlag.labels,
      excludeContracts: false,
    });

    // the federated graphs that are connected to the feature flag
    const federatedGraphs = await featureFlagRepo.getFederatedGraphsByFeatureFlag({
      featureFlagId: featureFlag.id,
      namespaceId: namespace.id,
      excludeDisabled: false,
      includeContracts: true,
    });

    const featureSubgraphs = await featureFlagRepo.getFeatureSubgraphsByFeatureFlagId({
      featureFlagId: featureFlag.id,
      namespaceId: namespace.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      featureFlag,
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
      federatedGraphs: labelMatchedFederatedGraphs.map((g) => ({
        federatedGraph: {
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
          supportsFederation: g.supportsFederation,
          contract: g.contract,
          admissionWebhookUrl: g.admissionWebhookURL,
          requestSeries: [],
          routerCompatibilityVersion: g.routerCompatibilityVersion,
        },
        isConnected: federatedGraphs.some((f) => f.id === g.id),
      })),
    };
  });
}
