import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CollectionProtocol,
  UpdateCollectionRequest,
  UpdateCollectionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CollectionRepository } from '../../repositories/CollectionRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

function stringToCollectionProtocol(protocol: string): CollectionProtocol {
  switch (protocol) {
    case 'grpc': {
      return CollectionProtocol.GRPC;
    }
    case 'mcp': {
      return CollectionProtocol.MCP;
    }
    default: {
      throw new Error(`Unknown protocol: ${protocol}`);
    }
  }
}

export function updateCollection(
  opts: RouterOptions,
  req: UpdateCollectionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdateCollectionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdateCollectionResponse>>(ctx, logger, async () => {
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
      };
    }

    // Check if collection exists
    const existingCollection = await collectionRepo.getCollection({
      id: req.collectionId,
      federatedGraphId: federatedGraph.id,
    });
    if (!existingCollection) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Collection with ID '${req.collectionId}' not found`,
        },
      };
    }

    // Validate required fields
    if (!req.name?.trim()) {
      return {
        response: {
          code: EnumStatusCode.ERR_BAD_REQUEST,
          details: 'Collection name is required and cannot be empty',
        },
      };
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

    // handle removed protocols
    const protocols = await collectionRepo.getCollectionProtocols(req.collectionId);
    const removedProtocols = protocols.filter(
      (protocol) => !uniqueProtocols.includes(stringToCollectionProtocol(protocol.protocol)),
    );

    for (const protocol of removedProtocols) {
      const filePath = `${authContext.organizationId}/${federatedGraph.id}/collections/${existingCollection.id}/${protocol.protocol}.json`;
      await opts.blobStorage.deleteObject({ key: filePath });
    }

    for (const protocol of uniqueProtocols) {
      if (protocol === CollectionProtocol.GRPC && req.grpcManifest) {
        await collectionRepo.uploadCollectionManifest({
          protocol: 'grpc',
          manifest: req.grpcManifest,
          filePathPrefix: `${authContext.organizationId}/${federatedGraph.id}/collections/${existingCollection.id}/`,
          blobStorage: opts.blobStorage,
        });
      }
      if (protocol === CollectionProtocol.MCP) {
        // TODO: handle MCP protocol
      }
    }

    // Update the collection
    await collectionRepo.updateCollection({
      id: req.collectionId,
      name: req.name,
      updatedById: authContext.userId,
      protocols: req.protocols.map((protocol) => (protocol === CollectionProtocol.GRPC ? 'grpc' : 'mcp')),
      filePathPrefix: `${authContext.organizationId}/${federatedGraph.id}/collections/${req.collectionId}/`,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
