import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCacheWarmerOperationsRequest,
  GetCacheWarmerOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CacheWarmerRepository } from '../../repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../repositories/OrganizationRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getCacheWarmerOperations(
  opts: RouterOptions,
  req: GetCacheWarmerOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCacheWarmerOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCacheWarmerOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);
    const organizationRepo = new OrganizationRepository(logger, opts.db);

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
        operations: [],
        totalCount: 0,
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
        operations: [],
        totalCount: 0,
        isCacheWarmerEnabled: false,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        operations: [],
        totalCount: 0,
        isCacheWarmerEnabled: false,
      };
    }

    if (!namespace.enableCacheWarmer) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Cache Warmer is not enabled for namespace '${req.namespace}'`,
        },
        operations: [],
        totalCount: 0,
        isCacheWarmerEnabled: false,
      };
    }

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `ClickHouse client is not available`,
        },
        operations: [],
        totalCount: 0,
        isCacheWarmerEnabled: false,
      };
    }

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient, opts.db);
    const operations = await cacheWarmerRepo.getCacheWarmerOperations({
      organizationId: authContext.organizationId,
      federatedGraphId: federatedGraph.id,
      limit: req.limit,
      offset: req.offset,
    });

    const operationsCount = await cacheWarmerRepo.getCacheWarmerOperationsCount({
      organizationId: authContext.organizationId,
      federatedGraphId: federatedGraph.id,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations: operations.map((op) => ({
        id: op.id,
        operationContent: op.operationContent || '',
        operationName: op.operationName || '',
        operationPersistedId: op.operationPersistedID || '',
        operationHash: op.operationHash || '',
        clientName: op.clientName || '',
        clientVersion: op.clientVersion || '',
        planningTime: op.planningTime || 0,
        isManuallyAdded: op.isManuallyAdded,
        createdAt: op.createdAt.toISOString() || '',
        createdBy: op.createdBy || '',
      })),
      totalCount: operationsCount,
      isCacheWarmerEnabled: namespace.enableCacheWarmer,
    };
  });
}
