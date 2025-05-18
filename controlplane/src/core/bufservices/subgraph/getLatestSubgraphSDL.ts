import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetLatestSubgraphSDLRequest,
  GetLatestSubgraphSDLResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getLatestSubgraphSDL(
  opts: RouterOptions,
  req: GetLatestSubgraphSDLRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetLatestSubgraphSDLResponse>> {
  req.namespace = req.namespace || DefaultNamespace;

  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetLatestSubgraphSDLResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const subgraph = await subgraphRepo.byName(req.name, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
        },
      };
    }

    if (!authContext.rbac.hasSubGraphReadAccess(subgraph)) {
      throw new UnauthorizedError();
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sdl: subgraph.schemaSDL,
      versionId: subgraph.schemaVersionId,
    };
  });
}
