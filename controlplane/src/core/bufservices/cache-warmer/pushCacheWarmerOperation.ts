import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PushCacheWarmerOperationRequest,
  PushCacheWarmerOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { Composer } from '../../../core/composition/composer.js';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { ContractRepository } from '../../../core/repositories/ContractRepository.js';
import { FederatedGraphRepository } from '../../../core/repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../../core/repositories/GraphCompositionRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../../core/repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../../core/repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OperationsRepository } from '../../../core/repositories/OperationsRepository.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';

export function pushCacheWarmerOperation(
  opts: RouterOptions,
  req: PushCacheWarmerOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PushCacheWarmerOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PushCacheWarmerOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepository = new NamespaceRepository(opts.db, authContext.organizationId);
    const organizationRepo = new OrganizationRepository(logger, opts.db);

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
      };
    }

    const cacheWarmerFeature = await organizationRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'cache-warmer',
    });
    if (!cacheWarmerFeature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Upgrade to a enterprise plan to enable cache warmer`,
        },
        isCacheWarmerEnabled: false,
      };
    }

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

    const namespace = await namespaceRepository.byId(federatedGraph!.namespaceId);
    if (!namespace?.enableCacheWarmer) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Cache Warmer is not enabled for the namespace`,
        },
      };
    }

    if (req.operationPersistedId) {
      const operationsRepository = new OperationsRepository(opts.db, federatedGraph.id);
      const existingPersistedOperation = await operationsRepository.getPersistedOperation(req.operationPersistedId);

      if (!existingPersistedOperation) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Operation with persistedID '${req.operationPersistedId}' doesn't exist.`,
          },
        };
      }
    }

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: `ClickHouse client is not available`,
        },
      };
    }

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient!, opts.db);
    await cacheWarmerRepo.addCacheWarmerOperations({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      createdById: authContext.userId,
      isManuallyAdded: true,
      operations: [
        {
          name: req.operationName,
          persistedID: req.operationPersistedId,
          content: req.operationContent,
          clientName: req.clientName,
        },
      ],
    });

    await cacheWarmerRepo.fetchAndUploadCacheWarmerOperations({
      blobStorage: opts.blobStorage,
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      logger,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
