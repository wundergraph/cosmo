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

    // Namespace is optional, if not provided, we get all the subgraphs
    const namespace = await namespaceRepo.byName(req.namespace);

    const featureFlags = await featureFlagRepo.getFeatureFlags({
      limit: req.limit,
      offset: req.offset,
      namespaceId: namespace?.id,
      query: req.query,
    });

    const totalCount = await featureFlagRepo.getFeatureFlagsCount({ namespaceId: namespace?.id });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      featureFlags,
      totalCount,
    };
  });
}
