import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateGraphCollectionOperationRequest,
  UpdateGraphCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { validateOperationDocument } from '../../util/graph-collection/validation.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function updateGraphCollectionOperation(
  opts: RouterOptions,
  req: UpdateGraphCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateGraphCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateGraphCollectionOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const document = validateOperationDocument(req.query, req.variables || undefined);
    if (!document.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: document.error,
        },
        contentHash: '',
      };
    }

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
        contentHash: '',
      };
    }

    const { operation } = operationWithGraph!;

    if (!access.canEdit) {
      throw new UnauthorizedError();
    }

    const result = await repo.updateOperation({
      id: operation.id,
      collectionId: operation.collectionId,
      query: req.query,
      variables: req.variables || undefined,
      expectedContentHash: req.expectedContentHash,
      userId: authContext.userId,
    });

    if (!result) {
      return {
        response: {
          code: EnumStatusCode.ERR_CONFLICT,
          details: 'This operation was changed by someone else since you opened it. Reload to see their version.',
        },
        contentHash: '',
      };
    }

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_collection_operation.updated',
      action: 'updated',
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
      contentHash: result.contentHash,
    };
  });
}
