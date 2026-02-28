import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  DeletePersistedOperationRequest,
  DeletePersistedOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { BlobStorage } from '../../blobstorage/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import type { PersistedOperationWithClientDTO } from '../../../types/index.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { createBlobStoragePath } from './utils.js';

export function deletePersistedOperation(
  opts: RouterOptions,
  req: DeletePersistedOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeletePersistedOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeletePersistedOperationResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
      };
    }
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
      };
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const operation = await operationsRepo.getPersistedOperation({
      operationId: req.operationId,
      clientName: req.clientName,
    });

    if (!operation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Persisted operation ${req.operationId} does not exist`,
        },
      };
    }

    const deletedOperation = await operationsRepo.deletePersistedOperation({
      operationId: req.operationId,
      clientName: req.clientName,
    });

    const path = createBlobStoragePath({
      organizationId: authContext.organizationId,
      fedGraphId: federatedGraph.id,
      clientName: operation.clientName,
      operationId: operation.operationId,
    });

    try {
      await opts.blobStorage.deleteObject({
        key: path,
      });
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        operation: deletedOperation
          ? {
              id: deletedOperation.id,
              operationId: deletedOperation.operationId,
              clientName: deletedOperation.clientName,
              operationNames: deletedOperation.operationNames,
            }
          : undefined,
      };
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Unknown error');
      logger.error(error, `Could not delete operation for ${operation.operationId} at ${path}`);

      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Failed to delete operation ${operation.operationId}`,
        },
      };
    }
  });
}
