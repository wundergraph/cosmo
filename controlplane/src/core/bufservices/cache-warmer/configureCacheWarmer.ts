import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ConfigureCacheWarmerRequest,
  ConfigureCacheWarmerResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { OrganizationRepository } from '../../../core/repositories/OrganizationRepository.js';
import { CacheWarmerRepository } from '../../../core/repositories/CacheWarmerRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function configureCacheWarmer(
  opts: RouterOptions,
  req: ConfigureCacheWarmerRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ConfigureCacheWarmerResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ConfigureCacheWarmerResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const organizationRepo = new OrganizationRepository(logger, opts.db);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
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

    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `ClickHouse client is not available`,
        },
      };
    }

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
      };
    }

    if (req.maxOperationsCount > 500) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `Max operations count should be less than 500`,
        },
      };
    }

    await namespaceRepo.updateConfiguration({ id: namespace.id, enableCacheWarming: req.enableCacheWarmer });

    const cacheWarmerRepo = new CacheWarmerRepository(opts.chClient, opts.db);
    if (req.enableCacheWarmer) {
      await cacheWarmerRepo.configureCacheWarmerConfig({
        namespaceId: namespace.id,
        maxOperationsCount: req.maxOperationsCount || 100,
      });
    } else {
      await cacheWarmerRepo.deleteCacheWarmerConfig({
        namespaceId: namespace.id,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
