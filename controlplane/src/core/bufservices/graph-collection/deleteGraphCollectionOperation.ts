import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteGraphCollectionOperationRequest,
  DeleteGraphCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function deleteGraphCollectionOperation(
  opts: RouterOptions,
  req: DeleteGraphCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteGraphCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteGraphCollectionOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const repo = new GraphCollectionsRepository(logger, opts.db, authContext.organizationId);
    const operationWithGraph = await repo.operationWithGraph({
      id: req.id,
      userId: authContext.userId,
      federatedGraphId: req.federatedGraphId,
      collectionId: req.collectionId,
    });
    const access = resolveCollectionAccess(operationWithGraph, authContext, 'Operation');

    if (!access.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: access.error,
        },
      };
    }

    const { operation } = operationWithGraph!;

    if (!access.canEdit) {
      throw new UnauthorizedError();
    }

    await repo.deleteOperation(operation.id, operation.collectionId);

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_collection_operation.deleted',
      action: 'deleted',
      auditableType: 'graph_collection_operation',
      auditableDisplayName: operation.name,
      actorId: authContext.userId,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      apiKeyName: authContext.apiKeyName,
      targetId: operationWithGraph!.collection.id,
      targetType: 'graph_collection',
      targetDisplayName: operationWithGraph!.collection.name,
      targetNamespaceId: operationWithGraph!.federatedGraph.namespaceId,
      targetNamespaceDisplayName: operationWithGraph!.federatedGraph.namespaceName,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
