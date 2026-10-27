import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetGraphCollectionOperationRequest,
  GetGraphCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { GraphCollectionsRepository } from '../../repositories/GraphCollectionsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { resolveCollectionAccess } from '../../util/graph-collection/permissions.js';

export function getGraphCollectionOperation(
  opts: RouterOptions,
  req: GetGraphCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetGraphCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetGraphCollectionOperationResponse>>(ctx, logger, async () => {
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
        operation: undefined,
      };
    }

    const { operation } = operationWithGraph!;

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operation: {
        id: operation.id,
        collectionId: operation.collectionId,
        name: operation.name,
        query: operation.query,
        variables: operation.variables ?? '',
        contentHash: operation.contentHash,
        updatedAt: operation.updatedAt?.toISOString() ?? '',
        updatedByEmail: operation.updatedByEmail ?? '',
      },
    };
  });
}
