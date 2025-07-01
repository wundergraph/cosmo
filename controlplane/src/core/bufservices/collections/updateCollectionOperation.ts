import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdateCollectionOperationRequest,
  UpdateCollectionOperationResponse
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CollectionRepository } from '../../repositories/CollectionRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function updateCollectionOperation(
  opts: RouterOptions,
  req: UpdateCollectionOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateCollectionOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateCollectionOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespace = DefaultNamespace;

    // Get repositories
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const collectionRepo = new CollectionRepository(opts.db);

    if (!req.operation) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'Operation is required',
        },
      };
    }

    // Validate operation fields
    if (!req.operation.id.trim()) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'Operation ID is required',
        },
      };
    }

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

    // Check if operation exists
    const existingOperation = await collectionRepo.getCollectionOperation({
      id: req.operation.id,
      collectionId: req.collectionId,
    });
    if (!existingOperation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Operation with ID '${req.operation.id}' not found`,
        },
      };
    }

    // If updating operation name, check for conflicts
    if (req.operation.name && req.operation.name !== existingOperation.name) {
      const conflictingOperation = await collectionRepo.getCollectionOperationByName({
        collectionId: req.collectionId,
        name: req.operation.name,
      });

      if (conflictingOperation && conflictingOperation.id !== req.operation.id) {
        return {
          response: {
            code: EnumStatusCode.ERR_ALREADY_EXISTS,
            details: `Operation with name '${req.operation.name}' already exists in collection`,
          },
        };
      }
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
      }
      else if (protocol.protocol === 'mcp') {
        // TODO: handle MCP protocol
      }
    }

    // Update the operation
    await collectionRepo.updateCollectionOperation({
      id: req.operation.id,
      name: req.operation.name,
      content: req.operation.content,
      updatedById: authContext.userId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
