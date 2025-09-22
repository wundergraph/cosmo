import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSubgraphByNameRequest,
  GetSubgraphByNameResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { convertToSubgraphType, enrichLogger, getLogger, handleError } from '../../util.js';
import { FeatureFlagRepository } from '../../repositories/FeatureFlagRepository.js';
import { SubgraphDTO } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getSubgraphByName(
  opts: RouterOptions,
  req: GetSubgraphByNameRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphByNameResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphByNameResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    const subgraph = await subgraphRepo.byName(req.name, req.namespace);

    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `The subgraph "${req.name}" was not found.`,
        },
        members: [],
      };
    }

    if (!authContext.rbac.hasSubGraphReadAccess(subgraph)) {
      throw new UnauthorizedError();
    }

    let baseSubgraph: SubgraphDTO | undefined;
    if (subgraph.isFeatureSubgraph) {
      const featureFlagRepository = new FeatureFlagRepository(logger, opts.db, authContext.organizationId);
      const result = await featureFlagRepository.getBaseSubgraphByFeatureSubgraphId({ id: subgraph.id });

      if (result) {
        baseSubgraph = result;
      }
    }

    const linkedSubgraph = await subgraphRepo.getLinkedSubgraph({ sourceSubgraphId: subgraph.id });

    return {
      graph: {
        id: subgraph.id,
        name: subgraph.name,
        lastUpdatedAt: subgraph.lastUpdatedAt,
        routingURL: subgraph.routingUrl,
        labels: subgraph.labels,
        targetId: subgraph.targetId,
        isEventDrivenGraph: subgraph.isEventDrivenGraph,
        readme: subgraph.readme,
        subscriptionUrl: subgraph.subscriptionUrl,
        subscriptionProtocol: subgraph.subscriptionProtocol,
        namespace: subgraph.namespace,
        websocketSubprotocol: subgraph.websocketSubprotocol || '',
        isFeatureSubgraph: subgraph.isFeatureSubgraph,
        baseSubgraphId: baseSubgraph?.id,
        baseSubgraphName: baseSubgraph?.name,
        type: convertToSubgraphType(subgraph.type),
        pluginData: subgraph.proto?.pluginData,
      },
      members: await subgraphRepo.getSubgraphMembers(subgraph.id),
      response: {
        code: EnumStatusCode.OK,
      },
      linkedSubgraph: linkedSubgraph
        ? {
            id: linkedSubgraph.targetSubgraphId,
            name: linkedSubgraph.targetSubgraphName,
            namespace: linkedSubgraph.targetSubgraphNamespace,
          }
        : undefined,
    };
  });
}
