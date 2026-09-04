import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  FeatureSubgraphInFlagComposition,
  GetFeatureFlagsInLatestCompositionByFederatedGraphRequest,
  GetFeatureFlagsInLatestCompositionByFederatedGraphResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { PlainMessage, FeatureFlagDTO } from '../../../types/index.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
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
          featureSubgraphs: [],
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
          featureSubgraphs: [],
        };
      }

      if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
        throw new UnauthorizedError();
      }

      // Get feature flag IDs from the latest valid composition
      const ffsInLatestValidComposition = await featureFlagRepo.getFeatureFlagSchemaVersionsInLatestComposition({
        federatedGraphId: federatedGraph.id,
        federatedGraphTargetId: federatedGraph.targetId,
      });

      const featureFlags: FeatureFlagDTO[] = [];
      const flagIdByComposedSchemaVersionId = new Map<string, string>();
      for (const ff of ffsInLatestValidComposition ?? []) {
        if (!ff.featureFlagId) {
          continue;
        }
        const flag = await featureFlagRepo.getFeatureFlagById({
          featureFlagId: ff.featureFlagId,
          namespaceId: namespace.id,
          includeSubgraphs: false,
        });
        if (flag) {
          // True means the composition reported for this flag is its last successful one, not its latest.
          featureFlags.push({ ...flag, hasFailedLatestComposition: ff.hasFailedLatestComposition });
          flagIdByComposedSchemaVersionId.set(ff.id, ff.featureFlagId);
        }
      }

      const compositionRepo = new GraphCompositionRepository(logger, opts.db);
      const pinnedFeatureSubgraphs = await compositionRepo.getFeatureSubgraphsByComposedSchemaVersionIds({
        schemaVersionIds: [...flagIdByComposedSchemaVersionId.keys()],
        organizationId: authContext.organizationId,
        rbac: authContext.rbac,
      });

      const featureSubgraphs: PlainMessage<FeatureSubgraphInFlagComposition>[] = [];
      for (const pinned of pinnedFeatureSubgraphs) {
        const featureFlagId = flagIdByComposedSchemaVersionId.get(pinned.composedSchemaVersionId);
        if (!featureFlagId) {
          continue;
        }

        featureSubgraphs.push({
          featureFlagId,
          id: pinned.id,
          name: pinned.name,
          targetId: pinned.targetId,
          schemaVersionId: pinned.schemaVersionId,
          routingUrl: pinned.routingUrl,
          subscriptionUrl: pinned.subscriptionUrl ?? '',
        });
      }

      return {
        response: {
          code: EnumStatusCode.OK,
        },
        featureFlags,
        featureSubgraphs,
      };
    },
  );
}
