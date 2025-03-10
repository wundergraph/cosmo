import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSubgraphByIdRequest,
  GetSubgraphByIdResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getSubgraphById(
  opts: RouterOptions,
  req: GetSubgraphByIdRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphByIdResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphByIdResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const subgraph = await subgraphRepo.byId(req.id);

    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.id}" was not found.`,
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
        baseSubgraphId: 'baseSubgraphId' in subgraph ? subgraph.baseSubgraphId : undefined,
        baseSubgraphName: 'baseSubgraphName' in subgraph ? subgraph.baseSubgraphName : undefined,
      },
      members: await subgraphRepo.getSubgraphMembers(subgraph.id),
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
