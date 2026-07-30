import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetCompositionDetailsRequest,
  GetCompositionDetailsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphCompositionRepository } from '../../repositories/GraphCompositionRepository.js';
import { NamespaceRepository } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { convertToSubgraphType, enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';

export function getCompositionDetails(
  opts: RouterOptions,
  req: GetCompositionDetailsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetCompositionDetailsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetCompositionDetailsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const featureFlagRepo = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
    const compositionRepo = new GraphCompositionRepository(logger, opts.db);

    const namespaceRepo = new NamespaceRepository(opts.db, authContext.organizationId);

    const namespace = await namespaceRepo.byName(req.namespace);
    if (!namespace) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Namespace '${req.namespace}' not found`,
        },
        compositionSubgraphs: [],
        featureFlagCompositions: [],
      };
    }

    const composition = await compositionRepo.getGraphComposition({
      compositionId: req.compositionId,
      organizationId: authContext.organizationId,
    });

    if (!composition) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Graph composition with '${req.compositionId}' does not exist`,
        },
        compositionSubgraphs: [],
        featureFlagCompositions: [],
      };
    }

    // A composition is always tied to a federated graph (its target is only nulled once the graph is deleted), so an
    // unresolvable graph means the composition is orphaned — treat it as not found rather than serving it without an
    // authorization check.
    const graph = composition.targetId ? await fedRepo.byTargetId(composition.targetId) : undefined;
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph for composition '${req.compositionId}' not found`,
        },
        compositionSubgraphs: [],
        featureFlagCompositions: [],
      };
    }
    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }
    const federatedGraphId = graph.id;

    const compositionSubgraphs = await compositionRepo.getCompositionSubgraphs({
      compositionId: composition.id,
      schemaVersionId: composition.schemaVersionId,
    });

    const changelogs = await fedRepo.fetchChangelogByVersion({
      schemaVersionId: composition.schemaVersionId,
    });

    let addCount = 0;
    let minusCount = 0;
    for (const log of changelogs) {
      if (log.changeType.includes('REMOVED')) {
        minusCount += 1;
      } else if (log.changeType.includes('ADDED')) {
        addCount += 1;
      } else if (log.changeType.includes('CHANGED')) {
        addCount += 1;
        minusCount += 1;
      }
    }

    // Feature flag compositions are resolved from a base composition, so only a base composition can have them.
    const featureFlagCompositions = composition.isFeatureFlagComposition
      ? []
      : await featureFlagRepo.getFeatureFlagCompositionsByBaseSchemaVersion({
          baseSchemaVersionId: composition.schemaVersionId,
          federatedGraphId,
          namespaceId: namespace.id,
          organizationId: authContext.organizationId,
        });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      composition,
      compositionSubgraphs: compositionSubgraphs.map((subgraph) => ({
        ...subgraph,
        subgraphType: convertToSubgraphType(subgraph.subgraphType),
      })),
      changeCounts: {
        additions: addCount,
        deletions: minusCount,
      },
      featureFlagCompositions,
    };
  });
}
