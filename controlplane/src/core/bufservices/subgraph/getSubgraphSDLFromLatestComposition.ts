import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSubgraphSDLFromLatestCompositionRequest,
  GetSubgraphSDLFromLatestCompositionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getSubgraphSDLFromLatestComposition(
  opts: RouterOptions,
  req: GetSubgraphSDLFromLatestCompositionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphSDLFromLatestCompositionResponse>> {
  req.namespace = req.namespace || DefaultNamespace;

  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphSDLFromLatestCompositionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    const subgraph = await subgraphRepo.byName(req.name, req.namespace);
    const federatedGraph = await federatedGraphRepo.byName(req.fedGraphName, req.namespace);
    if (!subgraph || !federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    if (!authContext.rbac.hasSubGraphReadAccess(subgraph)) {
      throw new UnauthorizedError();
    }

    const schemaVersion = await subgraphRepo.getSDLFromLatestComposition({
      subgraphTargetId: subgraph.targetId,
      federatedGraphTargetId: federatedGraph.targetId,
    });
    if (!schemaVersion) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sdl: schemaVersion.schema || undefined,
      versionId: schemaVersion.schemaVersionId,
    };
  });
}
