import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCacheWarmerConfigRequest,
  GetCacheWarmerConfigResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getCacheWarmerConfig(
  opts: RouterOptions,
  req: GetCacheWarmerConfigRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCacheWarmerConfigResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCacheWarmerConfigResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const organizationRepo = new OrganizationRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

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
        maxOperationsCount: 0,
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        isCacheWarmerEnabled: false,
        maxOperationsCount: 0,
      };
    }

    if (!authContext.rbac.hasNamespaceReadAccess(namespace)) {
      throw new UnauthorizedError();
    }

    if (!namespace.enableCacheWarmer) {
      return {
        response: {
          code: EnumStatusCode.OK,
        },
        isCacheWarmerEnabled: false,
        maxOperationsCount: 0,
      };
    }

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `ClickHouse client is not available`,
        },
        isCacheWarmerEnabled: false,
        maxOperationsCount: 0,
      };
    }

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient, opts.db);
    const cacheWarmerConfig = await cacheWarmerRepo.getCacheWarmerConfig({ namespaceId: namespace.id });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      isCacheWarmerEnabled: namespace.enableCacheWarmer,
      maxOperationsCount: cacheWarmerConfig?.maxOperationsCount || 100,
    };
  });
}
