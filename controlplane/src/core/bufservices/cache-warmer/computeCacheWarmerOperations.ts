import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ComputeCacheWarmerOperationsRequest,
  ComputeCacheWarmerOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Composer } from '../../../core/composition/composer.js';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { ContractRepository } from '../../../core/repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../../core/repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../../core/repositories/GraphCompositionRepository.js';
import { DefaultNamespace } from '../../../core/repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../../core/repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function computeCacheWarmerOperations(
  opts: RouterOptions,
  req: ComputeCacheWarmerOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ComputeCacheWarmerOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ComputeCacheWarmerOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const contractRepo = new ContractRepository(logger, opts.db, authContext.organizationId);
    const graphCompositionRepo = new GraphCompositionRepository(logger, opts.db);
    const composer = new Composer(
      logger,
      opts.db,
      fedGraphRepo,
      subgraphRepo,
      contractRepo,
      graphCompositionRepo,
      opts.chClient!,
    );

    const federatedGraph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace, {
      supportsFederation: true,
    });
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
      };
    }

    await composer.fetchAndUploadCacheWarmerOperations({
      blobStorage: opts.blobStorage,
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
