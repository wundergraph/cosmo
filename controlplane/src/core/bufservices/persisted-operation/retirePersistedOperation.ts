import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  RetirePersistedOperationRequest,
  RetirePersistedOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { BlobStorage } from '../../blobstorage/index.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import type { PersistedOperationWithClientDTO } from '../../../types/index.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { createBlobStoragePath } from './utils.js';

export function retirePersistedOperation(
  opts: RouterOptions,
  req: RetirePersistedOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RetirePersistedOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RetirePersistedOperationResponse>>(ctx, logger, async () => {
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
    });

    if (!operation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Persisted operation ${req.operationId} does not exist`,
        },
      };
    }

    const removedFromBlobStorageResult = await removePersistedOperationFromBlobStorage({
      operation,
      organizationId: authContext.organizationId,
      fedGraphId: federatedGraph.id,
      blobStorage: opts.blobStorage,
    });

    if (removedFromBlobStorageResult.error) {
      logger.error(
        removedFromBlobStorageResult.error.error,
        `Could not delete operation for ${removedFromBlobStorageResult.error.operationId} at ${removedFromBlobStorageResult.error.path}`,
      );

      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Failed to retire operation ${removedFromBlobStorageResult.error.operationId}`,
        },
      };
    }

    const retiredOperation = await operationsRepo.retirePersistedOperation({
      operationId: req.operationId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operation: retiredOperation
        ? {
            id: retiredOperation.id,
            operationId: retiredOperation.operationId,
            operationNames: retiredOperation.operationNames,
          }
        : undefined,
    };
  });
}

const removePersistedOperationFromBlobStorage = async ({
  operation,
  fedGraphId,
  organizationId,
  blobStorage,
}: {
  operation: PersistedOperationWithClientDTO;
  fedGraphId: string;
  organizationId: string;
  blobStorage: BlobStorage;
}): Promise<{
  error: {
    error: Error;
    operationId: string;
    path: string;
  } | null;
}> => {
  const path = createBlobStoragePath({
    organizationId,
    fedGraphId,
    clientName: operation.clientName,
    operationId: operation.operationId,
  });

  try {
    await blobStorage.deleteObject({
      key: path,
      abortSignal: AbortSignal.timeout(10_000),
    });
    return { error: null };
  } catch (e) {
    const error = e instanceof Error ? e : new Error('Unknown error');
    return {
      error: {
        error,
        operationId: operation.operationId,
        path,
      },
    };
  }
};
