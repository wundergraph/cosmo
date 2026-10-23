import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateGraphCollectionOperationRequest,
  CreateGraphCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { validateCollectionName, validateOperationDocument } from '../../util/graph-collection/validation.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function createGraphCollectionOperation(
  opts: RouterOptions,
  req: CreateGraphCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateGraphCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateGraphCollectionOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const validated = validateCollectionName(req.name, 'Operation');
    if (!validated.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: validated.error,
        },
        id: '',
        contentHash: '',
      };
    }
    const name = validated.name;

    const document = validateOperationDocument(req.query, req.variables || undefined);
    if (!document.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: document.error,
        },
        id: '',
        contentHash: '',
      };
    }

    const graphCollectionsRepo = new GraphCollectionsRepository(logger, opts.db, authContext.organizationId);
    const collectionWithGraph = await graphCollectionsRepo.collectionWithGraph(
      req.collectionId,
      authContext.userId,
      req.federatedGraphId,
    );
    const access = resolveCollectionAccess(collectionWithGraph, authContext, 'Collection');

    if (!access.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: access.error,
        },
        id: '',
        contentHash: '',
      };
    }

    if (!access.canEdit) {
      throw new UnauthorizedError();
    }

    const { id, contentHash } = await graphCollectionsRepo.createOperation({
      collectionId: req.collectionId,
      name,
      query: req.query,
      variables: req.variables || undefined,
      userId: authContext.userId,
    });

    await new AuditLogRepository(opts.db).addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_collection_operation.created',
      action: 'created',
      auditableType: 'graph_collection_operation',
      auditableDisplayName: name,
      actorId: authContext.userId,
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      apiKeyName: authContext.apiKeyName,
      targetId: collectionWithGraph!.collection.id,
      targetType: 'graph_collection',
      targetDisplayName: collectionWithGraph!.collection.name,
      targetNamespaceId: collectionWithGraph!.federatedGraph.namespaceId,
      targetNamespaceDisplayName: collectionWithGraph!.federatedGraph.namespaceName,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      id,
      contentHash,
    };
  });
}
