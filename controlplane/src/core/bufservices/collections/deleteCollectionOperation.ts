import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteCollectionOperationRequest,
  DeleteCollectionOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CollectionRepository } from '../../repositories/CollectionRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteCollectionOperation(
  opts: RouterOptions,
  req: DeleteCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteCollectionOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespace = req.namespace || DefaultNamespace;

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const collectionRepo = new CollectionRepository(opts.db);

    // Check if federated graph exists
    const federatedGraph = await fedGraphRepo.byName(req.federatedGraphName, namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found in namespace '${namespace}'`,
        },
      };
    }

    // Check if collection exists and belongs to the federated graph
    const existingCollection = await collectionRepo.getCollection({
      id: req.collectionId,
      federatedGraphId: federatedGraph.id,
    });

    if (!existingCollection) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Collection with ID '${req.collectionId}' not found in federated graph '${req.federatedGraphName}'`,
        },
      };
    }

    // Check if operation exists and belongs to the collection
    const existingOperation = await collectionRepo.getCollectionOperation({
      id: req.id,
      collectionId: req.collectionId,
    });

    if (!existingOperation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Operation with ID '${req.id}' not found in collection '${req.collectionId}'`,
        },
      };
    }

    const protocols = await collectionRepo.getCollectionProtocols(req.collectionId);
    for (const protocol of protocols) {
      if (protocol.protocol === 'grpc') {
        if (!req.grpcManifest) {
          return {
            response: {
              code: EnumStatusCode.ERR_BAD_REQUEST,
              details: 'GRPC manifest is required for GRPC protocol',
            },
          };
        }

        await collectionRepo.uploadCollectionManifest({
          protocol: 'grpc',
          manifest: req.grpcManifest,
          filePathPrefix: `${authContext.organizationId}/${federatedGraph.id}/collections/${req.collectionId}/`,
          blobStorage: opts.blobStorage,
        });
      } else if (protocol.protocol === 'mcp') {
        // TODO: handle MCP protocol
      }
    }

    // Delete the operation
    await collectionRepo.deleteCollectionOperation({
      id: req.id,
      collectionId: req.collectionId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
