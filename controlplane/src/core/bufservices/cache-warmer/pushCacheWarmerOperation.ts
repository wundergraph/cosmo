import { parse } from 'graphql';
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  PushCacheWarmerOperationRequest,
  PushCacheWarmerOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../../core/repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../../core/repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../../core/repositories/OperationsRepository.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

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
          code: EnumStatusCode.ERR_UPGRADE_PLAN,
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

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `ClickHouse client is not available`,
        },
      };
    }

    let clientName = '';

    if (req.operationPersistedId) {
      const operationsRepository = new OperationsRepository(opts.db, federatedGraph.id);
      const existingPersistedOperation = await operationsRepository.getPersistedOperation({
        operationId: req.operationPersistedId,
      });

      if (!existingPersistedOperation) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: `Persisted Operation with ID ${req.operationPersistedId} does not exist`,
          },
        };
      }

      clientName = existingPersistedOperation.clientName;
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
      operationContent: req.operationContent,
      clientName,
    });

    if (exists) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Operation already exists`,
        },
      };
    }

    await cacheWarmerRepo.addCacheWarmerOperations({
      operations: [
        {
          operationName: req.operationName,
          operationPersistedID: req.operationPersistedId,
          operationContent: req.operationContent,
          federatedGraphId: federatedGraph.id,
          organizationId: authContext.organizationId,
          createdById: authContext.userId,
          isManuallyAdded: true,
          clientName,
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
