import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteGraphCollectionRequest,
  DeleteGraphCollectionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function deleteGraphCollection(
  opts: RouterOptions,
  req: DeleteGraphCollectionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteGraphCollectionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteGraphCollectionResponse>>(ctx, logger, async () => {
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

    if (!access.canEdit) {
      throw new UnauthorizedError();
    }

    // The collection's saved operations cascade with it.
    await repo.deleteCollection(req.id, req.federatedGraphId);

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_collection.deleted',
      action: 'deleted',
      auditableType: 'graph_collection',
      auditableDisplayName: collectionWithGraph!.collection.name,
      actorId: authContext.userId,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      apiKeyName: authContext.apiKeyName,
      targetId: collectionWithGraph!.federatedGraph.targetId,
      targetType: 'federated_graph',
      targetDisplayName: collectionWithGraph!.federatedGraph.name,
      targetNamespaceId: collectionWithGraph!.federatedGraph.namespaceId,
      targetNamespaceDisplayName: collectionWithGraph!.federatedGraph.namespaceName,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
