import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteCollectionRequest,
  DeleteCollectionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CollectionRepository } from '../../repositories/CollectionRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteCollection(
  opts: RouterOptions,
  req: DeleteCollectionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteCollectionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteCollectionResponse>>(ctx, logger, async () => {
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

    const collectionDirectory = `${authContext.organizationId}/${federatedGraph.id}/collections/${req.collectionId}`;
    await opts.blobStorage.removeDirectory({ key: collectionDirectory });

    // Delete the collection
    await collectionRepo.deleteCollection({
      id: req.collectionId,
      federatedGraphId: federatedGraph.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
