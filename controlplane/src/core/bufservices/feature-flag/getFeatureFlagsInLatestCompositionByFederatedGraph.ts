import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetFeatureFlagsInLatestCompositionByFederatedGraphRequest,
  GetFeatureFlagsInLatestCompositionByFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagDTO } from '../../../types/index.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getFeatureFlagsInLatestCompositionByFederatedGraph(
  opts: RouterOptions,
  req: GetFeatureFlagsInLatestCompositionByFederatedGraphRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetFeatureFlagsInLatestCompositionByFederatedGraphResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetFeatureFlagsInLatestCompositionByFederatedGraphResponse>>(
    ctx,
    logger,
    async () => {
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
        };
      }

      if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
        throw new UnauthorizedError();
      }

      if (!federatedGraph.schemaVersionId) {
        return {
          response: {
            code: EnumStatusCode.OK,
          },
          featureFlags: [],
        };
      }

      // Get feature flag IDs from the latest valid composition
      const ffsInLatestValidComposition = await featureFlagRepo.getFeatureFlagSchemaVersionsByBaseSchemaVersion({
        baseSchemaVersionId: federatedGraph.schemaVersionId,
      });

      const featureFlags: FeatureFlagDTO[] = [];
      if (ffsInLatestValidComposition) {
        for (const ff of ffsInLatestValidComposition) {
          if (!ff.featureFlagId) {
            continue;
          }
          const flag = await featureFlagRepo.getFeatureFlagById({
            featureFlagId: ff.featureFlagId,
            namespaceId: namespace.id,
            includeSubgraphs: false,
          });
          if (flag) {
            featureFlags.push(flag);
          }
        }
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        featureFlags,
      };
    },
  );
}
