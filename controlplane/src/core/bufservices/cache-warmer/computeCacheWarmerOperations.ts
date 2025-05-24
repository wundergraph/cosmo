import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ComputeCacheWarmerOperationsRequest,
  ComputeCacheWarmerOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../../core/repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../../core/repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

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
    const namespaceRepository = new NamespaceRepository(opts.db, authContext.organizationId);
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
      };
    }

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
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

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient, opts.db);
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
