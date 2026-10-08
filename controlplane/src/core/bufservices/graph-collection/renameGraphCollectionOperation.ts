import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  RenameGraphCollectionOperationRequest,
  RenameGraphCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validateCollectionName } from '../../util.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function renameGraphCollectionOperation(
  opts: RouterOptions,
  req: RenameGraphCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RenameGraphCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RenameGraphCollectionOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const validated = validateCollectionName(req.name, 'Operation');
    if (!validated.ok) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: validated.error,
        },
      };
    }
    const name = validated.name;

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

    await repo.renameOperation(operation.id, name, operation.collectionId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
