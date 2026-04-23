import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  DeleteClientRequest,
  DeleteClientResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

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
        deletedOperations: [],
      };
    }

    if (authContext.organizationDeactivated || !authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const preview = await operationsRepo.previewDeleteClient(req.clientName);

    if (!preview) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Client '${req.clientName}' does not exist`,
        },
        deletedOperationsCount: 0,
        deletedOperations: [],
      };
    }

    const clientDirectory = `${authContext.organizationId}/${federatedGraph.id}/operations/${encodeURIComponent(req.clientName)}`;

    async function removeClientFromBlobStorage(key: string): Promise<
      | {
          ok: true;
        }
      | {
          ok: false;
          error: Error;
        }
    > {
      try {
        await opts.blobStorage.removeDirectory({ key });

        return { ok: true };
      } catch (e) {
        const error = e instanceof Error ? e : new Error('Unknown error');

        return { ok: false, error };
      }
    }

    if (preview.persistedOperationsCount > 0) {
      const removedFromBlobStorageMetadata = await removeClientFromBlobStorage(clientDirectory);

      if (!removedFromBlobStorageMetadata.ok) {
        logger.error(
          removedFromBlobStorageMetadata.error,
          `Could not delete operations for client ${req.clientName} at ${clientDirectory}`,
        );
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Failed to delete client ${req.clientName}`,
          },
          deletedOperationsCount: 0,
          deletedOperations: [],
        };
      }
    }

    const deletedClient = await operationsRepo.deleteClient(req.clientName);

    if (!deletedClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Client '${req.clientName}' does not exist`,
        },
        deletedOperationsCount: 0,
        deletedOperations: [],
      };
    }

    try {
      await operationsRepo.generateAndUploadManifest({
        organizationId: authContext.organizationId,
        blobStorage: opts.blobStorage,
        logger,
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Unknown error');
      logger.error(error, `Failed to regenerate PQL manifest after deleting client ${req.clientName}`, {
        federatedGraphId: federatedGraph.id,
        organizationId: authContext.organizationId,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      client: deletedClient.client,
      deletedOperationsCount: deletedClient.deletedOperationsCount,
      deletedOperations: deletedClient.deletedOperations,
    };
  });
}
