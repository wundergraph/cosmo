import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetUserAccessibleResourcesRequest,
  GetUserAccessibleResourcesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';

export function getUserAccessibleResources(
  opts: RouterOptions,
  req: GetUserAccessibleResourcesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetUserAccessibleResourcesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetUserAccessibleResourcesResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const namespaces = await namespaceRepo.list(authContext.rbac);
    const federatedGraphs = await fedRepo.list({ limit: 0, offset: 0, rbac: authContext.rbac });
    const subgraphs = await subgraphRepo.listAvailable({
      limit: 0,
      offset: 0,
      excludeFeatureSubgraphs: false,
      rbac: authContext.rbac,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      namespaces,
      federatedGraphs: federatedGraphs.map((g) => ({
        targetId: g.targetId,
        name: g.name,
        namespace: g.namespace,
      })),
      subgraphs: subgraphs.map((g) => ({
        targetId: g.targetId,
        name: g.name,
        namespace: g.namespace,
        federatedGraphId: g.federatedGraphId,
      })),
    };
  });
}
