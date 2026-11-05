import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  DeleteClientRequest,
  DeleteClientResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage } from '../../../types/index.js';
import { PublicError, UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { BlobStorage } from '../../blobstorage/index.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { withPersistedOperationsTransaction } from './transaction.js';
import { prepareOperationBlobRestore } from './restore.js';

export function deleteClient(
  opts: RouterOptions,
  req: DeleteClientRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteClientResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteClientResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
        deletedOperationsCount: 0,
      };
    }

    if (authContext.organizationDeactivated || !authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    return withPersistedOperationsTransaction(opts.db, federatedGraph, (operationsRepo) =>
      deleteClientOperations(operationsRepo, authContext.organizationId, federatedGraph.id),
    );
  });

  async function deleteClientOperations(
    operationsRepo: OperationsRepository,
    organizationId: string,
    federatedGraphId: string,
  ): Promise<PlainMessage<DeleteClientResponse>> {
    const preview = await operationsRepo.previewDeleteClient(req.clientName);
    if (!preview) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Client '${req.clientName}' does not exist`,
        },
        deletedOperationsCount: 0,
      };
    }

    const restoreBlobs = await prepareOperationBlobRestore(
      opts.blobStorage,
      await operationsRepo.getPersistedOperations(preview.id),
      logger,
    );
    const deletedClient = await operationsRepo.deleteClient(req.clientName);
    if (!deletedClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Client '${req.clientName}' does not exist`,
        },
        deletedOperationsCount: 0,
      };
    }

    if (preview.persistedOperationsCount > 0) {
      const clientDirectory = `${organizationId}/${federatedGraphId}/operations/${encodeURIComponent(req.clientName)}/`;
      const removedFromBlobStorageMetadata = await removeClientFromBlobStorage(clientDirectory, {
        storage: opts.blobStorage,
      });

      if (!removedFromBlobStorageMetadata.ok) {
        logger.error(
          removedFromBlobStorageMetadata.error,
          `Could not delete operations for client ${req.clientName} at ${clientDirectory}`,
        );
        throw new PublicError(
          EnumStatusCode.ERR,
          `Failed to delete operations for client ${req.clientName}`,
          removedFromBlobStorageMetadata.error,
        );
      }
    }

    try {
      await operationsRepo.generateAndUploadManifest({
        organizationId,
        blobStorage: opts.blobStorage,
        logger,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Unknown error');
      logger.error(error, `Failed to regenerate PQL manifest after deleting client ${req.clientName}`, {
        federatedGraphId,
        organizationId,
      });
      await restoreBlobs();
      throw new PublicError(EnumStatusCode.ERR, 'Failed to publish persisted operations manifest', error);
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      client: deletedClient.client,
      deletedOperationsCount: preview.persistedOperationsCount,
    };
  }
}

async function removeClientFromBlobStorage(
  key: string,
  {
    storage,
  }: {
    storage: BlobStorage;
  },
): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      error: Error;
    }
> {
  try {
    await storage.removeDirectory({ key });

    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e : new Error('Unknown error');

    return { ok: false, error };
  }
}
