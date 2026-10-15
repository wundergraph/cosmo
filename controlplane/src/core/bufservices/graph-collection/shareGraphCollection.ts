import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ShareGraphCollectionRequest,
  ShareGraphCollectionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function shareGraphCollection(
  opts: RouterOptions,
  req: ShareGraphCollectionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ShareGraphCollectionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ShareGraphCollectionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new GraphCollectionsRepository(logger, opts.db, authContext.organizationId);
    const collectionWithGraph = await repo.collectionWithGraph(req.id, authContext.userId, req.federatedGraphId);
    const access = resolveCollectionAccess(collectionWithGraph, authContext, 'Collection');

    if (!access.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: access.error,
        },
      };
    }

    if (collectionWithGraph!.collection.privateToUserId === null) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: 'This collection is already shared with the team',
        },
      };
    }

    // Sharing turns a personal row into a graph-scoped resource, so it needs
    // both ownership and the write access that mutating a team collection
    // requires. `canEdit` alone is not enough here: it is satisfied by mere
    // ownership while the collection is still private.
    const { collection, federatedGraph } = collectionWithGraph!;

    if (
      collection.privateToUserId !== authContext.userId ||
      !authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph) ||
      authContext.organizationDeactivated
    ) {
      throw new UnauthorizedError();
    }

    await repo.shareCollection(req.id, req.federatedGraphId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
