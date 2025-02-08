import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CheckFederatedGraphRequest,
  CheckFederatedGraphResponse,
  CompositionError,
  CompositionWarning,
  Subgraph,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { parse } from 'graphql';
import { composeSubgraphs } from '../../composition/composition.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, isValidLabelMatchers } from '../../util.js';

export function checkFederatedGraph(
  opts: RouterOptions,
  req: CheckFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CheckFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CheckFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        compositionErrors: [],
        subgraphs: [],
        compositionWarnings: [],
      };
    }

    const federatedGraph = await fedGraphRepo.byName(req.name, req.namespace, {
      supportsFederation: true,
    });
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.name}' not found`,
        },
        compositionErrors: [],
        subgraphs: [],
        compositionWarnings: [],
      };
    }

    if (!isValidLabelMatchers(req.labelMatchers)) {
      return {
        response: {
          code: EnumStatusCode.ERR_INVALID_LABELS,
          details: `One or more labels in the matcher were found to be invalid`,
        },
        compositionErrors: [],
        subgraphs: [],
        compositionWarnings: [],
      };
    }

    const subgraphs = await subgraphRepo.byGraphLabelMatchers({
      labelMatchers: req.labelMatchers,
      namespaceId: federatedGraph.namespaceId,
    });

    const subgraphsDetails: PlainMessage<Subgraph>[] = subgraphs.map((s) => ({
      id: s.id,
      name: s.name,
      routingURL: s.routingUrl,
      labels: s.labels,
      lastUpdatedAt: s.lastUpdatedAt,
      targetId: s.targetId,
      isEventDrivenGraph: s.isEventDrivenGraph,
      subscriptionUrl: s.subscriptionUrl,
      subscriptionProtocol: s.subscriptionProtocol,
      namespace: s.namespace,
      websocketSubprotocol: s.websocketSubprotocol || '',
      isFeatureSubgraph: s.isFeatureSubgraph,
    }));

    const result = composeSubgraphs(
      subgraphs.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.routingUrl,
        definitions: parse(s.schemaSDL),
      })),
    );

    const compositionWarnings: PlainMessage<CompositionWarning>[] = [];
    for (const warning of result.warnings) {
      compositionWarnings.push({
        message: warning.message,
        federatedGraphName: req.name,
        namespace: federatedGraph.namespace,
        featureFlag: '',
      });
    }

    if (!result.success) {
      const compositionErrors: PlainMessage<CompositionError>[] = [];
      for (const error of result.errors) {
        compositionErrors.push({
          message: error.message,
          federatedGraphName: req.name,
          namespace: federatedGraph.namespace,
          featureFlag: '',
        });
      }

      if (compositionErrors.length > 0) {
        return {
          response: {
            code: EnumStatusCode.ERR_SUBGRAPH_COMPOSITION_FAILED,
          },
          compositionErrors,
          subgraphs: subgraphsDetails,
          compositionWarnings,
        };
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      compositionErrors: [],
      subgraphs: subgraphsDetails,
      compositionWarnings,
    };
  });
}
