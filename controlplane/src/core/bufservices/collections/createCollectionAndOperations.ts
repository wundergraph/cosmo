import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CollectionProtocol,
  CreateCollectionAndOperationsRequest,
  CreateCollectionAndOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CollectionRepository } from '../../repositories/CollectionRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createCollectionAndOperations(
  opts: RouterOptions,
  req: CreateCollectionAndOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateCollectionAndOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateCollectionAndOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const namespace = req.namespace || DefaultNamespace;

    // Get repositories
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
        collectionId: '',
      };
    }

    // Validate required fields
    if (!req.name?.trim()) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'Collection name is required and cannot be empty',
        },
        collectionId: '',
      };
    }

    for (const operation of req.operations) {
      if (!operation.name?.trim()) {
        return {
          response: {
            code: EnumStatusCode.ERR_BAD_REQUEST,
            details: 'Operation name is required for all operations',
          },
          collectionId: '',
        };
      }

      if (!operation.content?.trim()) {
        return {
          response: {
            code: EnumStatusCode.ERR_BAD_REQUEST,
            details: 'Operation content is required for all operations',
          },
          collectionId: '',
        };
      }
    }

    const uniqueProtocols = [...new Set(req.protocols)];
    for (const protocol of uniqueProtocols) {
      if (protocol === CollectionProtocol.GRPC && !req.grpcManifest) {
        return {
          response: {
            code: EnumStatusCode.ERR_BAD_REQUEST,
            details: 'GRPC manifest is required for GRPC protocol',
          },
          collectionId: '',
        };
      }
    }

    // Check if collection with the same name already exists for this federated graph
    const existingCollection = await collectionRepo.getCollectionByName(federatedGraph.id, req.name.trim());
    if (existingCollection) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Collection with name '${req.name}' already exists for this federated graph`,
        },
        collectionId: existingCollection.id,
      };
    }

    // Create the collection
    const collection = await collectionRepo.createCollection({
      name: req.name.trim(),
      federatedGraphId: federatedGraph.id,
      createdById: authContext.userId,
    });

    // Create the operations
    for (const operation of req.operations) {
      // Create the operation
      await collectionRepo.createCollectionOperation({
        id: operation.id,
        collectionId: collection.id,
        name: operation.name,
        content: operation.content,
        createdById: authContext.userId,
      });
    }

    for (const protocol of uniqueProtocols) {
      if (protocol === CollectionProtocol.GRPC && req.grpcManifest) {
        await collectionRepo.uploadCollectionManifest({
          protocol: 'grpc',
          manifest: req.grpcManifest,
          filePathPrefix: `${authContext.organizationId}/${federatedGraph.id}/collections/${collection.id}/`,
          blobStorage: opts.blobStorage,
        });
      }
      if (protocol === CollectionProtocol.MCP) {
        // TODO: handle MCP protocol
      }
    }

    await collectionRepo.setCollectionProtocols({
      collectionId: collection.id,
      collectionProtocols: uniqueProtocols.map((protocol) => (protocol === CollectionProtocol.GRPC ? 'grpc' : 'mcp')),
      filePathPrefix: `${authContext.organizationId}/${federatedGraph.id}/collections/${collection.id}/`,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      collectionId: collection.id,
    };
  });
}
