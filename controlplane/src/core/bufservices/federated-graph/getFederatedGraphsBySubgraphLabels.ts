import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFederatedGraphsBySubgraphLabelsRequest,
  GetFederatedGraphsBySubgraphLabelsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFederatedGraphsBySubgraphLabels(
  opts: RouterOptions,
  req: GetFederatedGraphsBySubgraphLabelsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFederatedGraphsBySubgraphLabelsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  req.namespace = req.namespace || DefaultNamespace;

  return handleError<PlainMessage<GetFederatedGraphsBySubgraphLabelsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);

    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Subgraph '${req.subgraphName}' not found`,
        },
        graphs: [],
      };
    }

    if (!authContext.rbac.hasSubGraphReadAccess(subgraph)) {
      throw new UnauthorizedError();
    }

    const federatedGraphs = await fedGraphRepo.bySubgraphLabels({
      labels: subgraph.labels,
      namespaceId: subgraph.namespaceId,
    });

    return {
      graphs: federatedGraphs.map((g) => ({
        id: g.id,
        name: g.name,
        namespace: g.namespace,
        labelMatchers: g.labelMatchers,
        routingURL: g.routingUrl,
        lastUpdatedAt: g.lastUpdatedAt,
        connectedSubgraphs: g.subgraphsCount,
        compositionErrors: g.compositionErrors ?? '',
        isComposable: g.isComposable,
        compositionId: g.compositionId,
        requestSeries: [],
        targetId: g.targetId,
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
