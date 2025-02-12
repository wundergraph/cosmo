import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteCacheWarmerOperationRequest,
  DeleteCacheWarmerOperationResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { FederatedGraphRepository } from '../../../core/repositories/FederatedGraphRepository.js';
import { DefaultNamespace, NamespaceRepository } from '../../../core/repositories/NamespaceRepository.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function deleteCacheWarmerOperation(
  opts: RouterOptions,
  req: DeleteCacheWarmerOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteCacheWarmerOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteCacheWarmerOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
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

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `ClickHouse client is not available`,
        },
      };
    }

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient!, opts.db);
    const operation = await cacheWarmerRepo.getOperationById({
      id: req.id,
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
    });

    if (!operation) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Could not delete the operation as it's not found`,
        },
      };
    }

    await cacheWarmerRepo.deleteOperationById({
      id: req.id,
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
