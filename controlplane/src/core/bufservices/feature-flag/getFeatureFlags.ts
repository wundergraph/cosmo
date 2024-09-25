import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureFlagsRequest,
  GetFeatureFlagsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getFeatureFlags(
  opts: RouterOptions,
  req: GetFeatureFlagsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureFlagsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureFlagsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    let namespaceId: string | undefined;
    // Namespace is optional, if not provided, we get all the feature flags
    if (req.namespace) {
      const namespace = await namespaceRepo.byName(req.namespace);
      if (!namespace) {
        return {
          response: {
            code: EnumStatusCode.ERR_NOT_FOUND,
            details: `Could not find namespace ${req.namespace}`,
          },
          featureFlags: [],
          totalCount: 0,
        };
      }
      namespaceId = namespace.id;
    }

    const featureFlags = await featureFlagRepo.getFeatureFlags({
      limit: req.limit,
      offset: req.offset,
      namespaceId,
      query: req.query,
    });

    const totalCount = await featureFlagRepo.getFeatureFlagsCount({ namespaceId });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      featureFlags,
      totalCount,
    };
  });
}
