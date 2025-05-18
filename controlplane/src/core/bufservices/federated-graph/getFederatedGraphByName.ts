import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFederatedGraphByNameRequest,
  GetFederatedGraphByNameResponse,
  RequestSeriesItem,
  Subgraph,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagDTO } from '../../../types/index.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import { AnalyticsDashboardViewRepository } from '../../repositories/analytics/AnalyticsDashboardViewRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFederatedGraphByName(
  opts: RouterOptions,
  req: GetFederatedGraphByNameRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFederatedGraphByNameResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFederatedGraphByNameResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    const federatedGraph = await fedRepo.byName(req.name, req.namespace);

    if (!federatedGraph) {
      return {
        subgraphs: [],
        featureFlags: [],
        featureFlagsInLatestValidComposition: [],
        featureSubgraphs: [],
        graphRequestToken: '',
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Graph '${req.name}' not found`,
        },
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    let requestSeries: PlainMessage<RequestSeriesItem>[] = [];
    if (req.includeMetrics && opts.chClient) {
      const analyticsDashRepo = new AnalyticsDashboardViewRepository(opts.chClient);
      requestSeries = await analyticsDashRepo.getWeeklyRequestSeries(federatedGraph.id, authContext.organizationId);
    }

    const list = await subgraphRepo.listByFederatedGraph({
      federatedGraphTargetId: federatedGraph.targetId,
      published: false,
      rbac: authContext.rbac,
    });

    const featureFlags = await featureFlagRepo.getFeatureFlagsByFederatedGraph({
      federatedGraph,
      namespaceId: federatedGraph.namespaceId,
      rbac: authContext.rbac,
    });

    const featureFlagsInLatestValidComposition: FeatureFlagDTO[] = [];

    if (federatedGraph.schemaVersionId) {
      const ffsInLatestValidComposition = await featureFlagRepo.getFeatureFlagSchemaVersionsByBaseSchemaVersion({
        baseSchemaVersionId: federatedGraph.schemaVersionId,
      });
      if (ffsInLatestValidComposition) {
        for (const ff of ffsInLatestValidComposition) {
          const flag = featureFlags.find((f) => f.id === ff.featureFlagId);
          if (flag) {
            featureFlagsInLatestValidComposition.push(flag);
          }
        }
      }
    }

    const featureSubgraphs: Subgraph[] = [];
    for (const ff of featureFlags) {
      for (const fs of ff.featureSubgraphs) {
        if (!featureSubgraphs.some((f) => f.id === fs.id)) {
          featureSubgraphs.push(
            new Subgraph({
              id: fs.id,
              name: fs.name,
              routingURL: fs.routingUrl,
              lastUpdatedAt: fs.lastUpdatedAt,
              labels: fs.labels,
              targetId: fs.targetId,
              subscriptionUrl: fs.subscriptionUrl,
              namespace: fs.namespace,
              subscriptionProtocol: fs.subscriptionProtocol,
              isEventDrivenGraph: fs.isEventDrivenGraph,
              isV2Graph: fs.isV2Graph,
              websocketSubprotocol: fs.websocketSubprotocol || '',
              isFeatureSubgraph: fs.isFeatureSubgraph,
              baseSubgraphId: fs.baseSubgraphId,
              baseSubgraphName: fs.baseSubgraphName,
            }),
          );
        }
      }
    }

    const routerRequestToken = await fedRepo.getGraphSignedToken({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
    });

    if (!routerRequestToken) {
      return {
        subgraphs: [],
        featureFlags: [],
        featureFlagsInLatestValidComposition: [],
        featureSubgraphs: [],
        graphRequestToken: '',
        response: {
          code: EnumStatusCode.ERR,
          details: 'Router Request token not found',
        },
      };
    }

    return {
      graph: {
        id: federatedGraph.id,
        targetId: federatedGraph.targetId,
        name: federatedGraph.name,
        namespace: federatedGraph.namespace,
        routingURL: federatedGraph.routingUrl,
        labelMatchers: federatedGraph.labelMatchers,
        lastUpdatedAt: federatedGraph.lastUpdatedAt,
        connectedSubgraphs: federatedGraph.subgraphsCount,
        compositionErrors: federatedGraph.compositionErrors ?? '',
        compositionId: federatedGraph.compositionId,
        isComposable: federatedGraph.isComposable,
        requestSeries,
        readme: federatedGraph.readme,
        supportsFederation: federatedGraph.supportsFederation,
        contract: federatedGraph.contract,
        admissionWebhookUrl: federatedGraph.admissionWebhookURL,
        routerCompatibilityVersion: federatedGraph.routerCompatibilityVersion,
      },
      subgraphs: list.map((g) => ({
        id: g.id,
        name: g.name,
        routingURL: g.routingUrl,
        lastUpdatedAt: g.lastUpdatedAt,
        labels: g.labels,
        targetId: g.targetId,
        subscriptionUrl: g.subscriptionUrl,
        namespace: g.namespace,
        subscriptionProtocol: g.subscriptionProtocol,
        isEventDrivenGraph: g.isEventDrivenGraph,
        isV2Graph: g.isV2Graph,
        websocketSubprotocol: g.websocketSubprotocol || '',
        isFeatureSubgraph: g.isFeatureSubgraph,
      })),
      featureFlags,
      graphRequestToken: routerRequestToken,
      featureFlagsInLatestValidComposition,
      featureSubgraphs,
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
