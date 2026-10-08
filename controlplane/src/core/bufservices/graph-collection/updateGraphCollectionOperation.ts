import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateGraphCollectionOperationRequest,
  UpdateGraphCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
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

    if (!req.query.trim()) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'Operation cannot be empty',
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

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      contentHash: result.contentHash,
    };
  });
}
