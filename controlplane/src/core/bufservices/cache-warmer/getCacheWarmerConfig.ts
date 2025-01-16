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
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      isCacheWarmerEnabled: namespace.enableCacheWarmer,
    };
  });
}
