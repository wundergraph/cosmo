import { parse } from 'graphql';
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PushCacheWarmerOperationRequest,
  PushCacheWarmerOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CacheWarmerRepository } from '../../repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

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

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const cacheWarmerFeature = await organizationRepo.getFeature({
      organizationId: authContext.organizationId,
      featureId: 'cache-warmer',
    });
    if (!cacheWarmerFeature?.enabled) {
      return {
        response: {
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
          details: `Upgrade to a enterprise plan to enable cache warmer`,
        },
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

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
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

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `ClickHouse client is not available`,
        },
      };
    }

    let clientName = '';
    let operationContent = '';

    if (req.operationPersistedId) {
      const operationsRepository = new OperationsRepository(opts.db, federatedGraph.id);
      const existingPersistedOperation = await operationsRepository.getPersistedOperation({
        operationId: req.operationPersistedId,
      });

      if (!existingPersistedOperation || !existingPersistedOperation.contents) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Persisted Operation with ID ${req.operationPersistedId} does not exist`,
          },
        };
      }

      clientName = existingPersistedOperation.clientName;
      operationContent = existingPersistedOperation.contents;
    }

    if (req.operationContent) {
      try {
        const node = parse(req.operationContent);

        if (node.definitions.length === 0) {
          return {
            response: {
              code: EnumStatusCode.ERR,
              details: `Operation is not valid GraphQL: No definitions found`,
            },
          };
        }

        // check if operation name is provided and if it matches with any of the operation names in the operation content
        if (req.operationName) {
          const operationNames = node.definitions.map((def) => {
            if (def.kind === 'OperationDefinition') {
              return def.name?.value;
            }
            return undefined;
          });

          if (!operationNames.includes(req.operationName)) {
            return {
              response: {
                code: EnumStatusCode.ERR,
                details: `An operation definition with the name '${req.operationName}' was not found in the provided operation content`,
              },
            };
          }
        }
      } catch (e: any) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `GraphQL operation is not valid GraphQL: ${e}`,
          },
        };
      }
    }

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient!, opts.db);

    const exists = await cacheWarmerRepo.operationExists({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      persistedId: req.operationPersistedId,
      // persisted operation has more precedence than operation content
      operationContent: operationContent || req.operationContent,
      clientName,
    });

    if (exists) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Operation already exists`,
        },
      };
    }

    const cacheWarmerConfig = await cacheWarmerRepo.getCacheWarmerConfig({
      namespaceId: namespace.id,
    });

    const manuallyAddedOperationsCount = await cacheWarmerRepo.getCacheWarmerOperationsCount({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      isManuallyAdded: true,
    });

    await cacheWarmerRepo.addCacheWarmerOperations({
      operations: [
        {
          operationName: req.operationName,
          operationPersistedID: req.operationPersistedId,
          // persisted operation has more precedence than operation content
          operationContent: operationContent || req.operationContent,
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
          createdById: authContext.userId,
          isManuallyAdded: true,
          clientName,
        },
      ],
    });

    if (cacheWarmerConfig && manuallyAddedOperationsCount >= cacheWarmerConfig.maxOperationsCount) {
      const difference = manuallyAddedOperationsCount - cacheWarmerConfig.maxOperationsCount + 1;
      await cacheWarmerRepo.deleteExcessManuallyAddedOperations({
        federatedGraphId: federatedGraph.id,
        organizationId: authContext.organizationId,
        noOfExcessOperations: difference,
      });
    }

    await cacheWarmerRepo.fetchAndUploadCacheWarmerOperations({
      blobStorage: opts.blobStorage,
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      namespaceId: namespace.id,
      logger,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
