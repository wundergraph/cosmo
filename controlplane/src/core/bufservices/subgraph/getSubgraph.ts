import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetSubgraphRequest, GetSubgraphResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { SubgraphDTO } from '../../../types/index.js';

export function getSubgraph(
  opts: RouterOptions,
  req: GetSubgraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;
    let subgraph: SubgraphDTO | undefined;

    if (req.id) {
      subgraph = await subgraphRepo.byId(req.id);
    } else {
      subgraph = await subgraphRepo.byName(req.name, req.namespace);
    }

    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.name}" was not found.`,
        },
        members: [],
      };
    }

    return {
      graph: {
        id: subgraph.id,
        name: subgraph.name,
        lastUpdatedAt: subgraph.lastUpdatedAt,
        routingURL: subgraph.routingUrl,
        labels: subgraph.labels,
        targetId: subgraph.targetId,
        isEventDrivenGraph: subgraph.isEventDrivenGraph,
        readme: subgraph.readme,
        subscriptionUrl: subgraph.subscriptionUrl,
        subscriptionProtocol: subgraph.subscriptionProtocol,
        namespace: subgraph.namespace,
        websocketSubprotocol: subgraph.websocketSubprotocol || '',
        isFeatureSubgraph: subgraph.isFeatureSubgraph,
      },
      members: await subgraphRepo.getSubgraphMembers(subgraph.id),
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
