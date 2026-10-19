import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetGraphCollectionsRequest,
  GetGraphCollectionsResponse,
  GraphCollectionSortBy,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { canMutateCollection } from '../../util/graph-collection/permissions.js';

export function getGraphCollections(
  opts: RouterOptions,
  req: GetGraphCollectionsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetGraphCollectionsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetGraphCollectionsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        collections: [],
        canCreateTeamCollection: false,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph) || authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const repo = new GraphCollectionsRepository(logger, opts.db, authContext.organizationId);
    const collections = await repo.listByFederatedGraphId(
      federatedGraph.id,
      authContext.userId,
      req.sortBy === GraphCollectionSortBy.GRAPH_COLLECTION_SORT_CREATED_AT ? 'createdAt' : 'name',
    );

    const hasGraphWriteAccess = authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      canCreateTeamCollection: hasGraphWriteAccess && !authContext.organizationDeactivated,
      collections: collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        isTeamScoped: collection.privateToUserId === null,
        createdByEmail: collection.createdByEmail ?? '',
        canEdit: canMutateCollection({
          collection,
          userId: authContext.userId,
          hasGraphWriteAccess,
          organizationDeactivated: authContext.organizationDeactivated,
        }),
        createdAt: collection.createdAt.toISOString(),
        updatedAt: collection.updatedAt?.toISOString() ?? '',
        operations: collection.operations.map((operation) => ({
          id: operation.id,
          name: operation.name,
          updatedAt: operation.updatedAt?.toISOString() ?? '',
          updatedByEmail: operation.updatedByEmail ?? '',
        })),
      })),
    };
  });
}
