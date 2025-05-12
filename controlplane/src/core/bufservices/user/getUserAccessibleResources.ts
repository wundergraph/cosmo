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

export function getUserAccessibleResources(
  opts: RouterOptions,
  req: GetUserAccessibleResourcesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetUserAccessibleResourcesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetUserAccessibleResourcesResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    const isOrgAdminOrDeveloper = authContext.rbac.isOrganizationAdminOrDeveloper;
    const federatedGraphs = isOrgAdminOrDeveloper
      ? await fedRepo.list({ limit: 0, offset: 0 })
      : await fedRepo.getAccessibleFederatedGraphs(authContext.userId, authContext.rbac.resources);

    const subgraphs = isOrgAdminOrDeveloper
      ? await subgraphRepo.list({ limit: 0, offset: 0, excludeFeatureSubgraphs: false })
      : await subgraphRepo.getAccessibleSubgraphs(authContext.userId, authContext.rbac.resources);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
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
