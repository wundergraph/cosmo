import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureFlagsByFederatedGraphRequest,
  GetFeatureFlagsByFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagDTO } from '../../../types/index.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFeatureFlagsByFederatedGraph(
  opts: RouterOptions,
  req: GetFeatureFlagsByFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureFlagsByFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureFlagsByFederatedGraphResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace ${req.namespace} not found`,
        },
        featureFlags: [],
        totalCount: 0,
      };
    }

    const federatedGraph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated Graph '${req.federatedGraphName}' not found`,
        },
        featureFlags: [],
        totalCount: 0,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const matchedFeatureFlags = await featureFlagRepo.getMatchedFeatureFlags({
      namespaceId: namespace.id,
      fedGraphLabelMatchers: federatedGraph.labelMatchers,
      excludeDisabled: false,
    });

    const featureFlags: FeatureFlagDTO[] = [];
    for (const f of matchedFeatureFlags) {
      const featureFlag = await featureFlagRepo.getFeatureFlagById({
        featureFlagId: f.id,
        namespaceId: namespace.id,
      });
      if (featureFlag) {
        featureFlags.push(featureFlag);
      }
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      featureFlags,
      totalCount: featureFlags.length,
    };
  });
}
