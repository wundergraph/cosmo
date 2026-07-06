import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSdlBySchemaVersionRequest,
  GetSdlBySchemaVersionResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import type { PlainMessage } from '../../../types/index.js';

export function getSdlBySchemaVersion(
  opts: RouterOptions,
  req: GetSdlBySchemaVersionRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSdlBySchemaVersionResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSdlBySchemaVersionResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    // Determine whether the target is a federated graph or a subgraph and gate
    // accordingly. `byTargetId` returns undefined when the target isn't of that
    // kind, so we try the federated graph first and fall back to the subgraph.
    // A target that resolves to neither falls through (returns empty SDL).
    if (req.targetId) {
      const graph = await fedRepo.byTargetId(req.targetId);
      if (graph) {
        if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
          throw new UnauthorizedError();
        }
      } else {
        const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
        const subgraph = await subgraphRepo.byTargetId(req.targetId);
        if (subgraph && !authContext.rbac.hasSubGraphReadAccess(subgraph)) {
          throw new UnauthorizedError();
        }
      }
    }

    const sdlSchema = await fedRepo.getSdlBasedOnSchemaVersion({
      targetId: req.targetId,
      schemaVersionId: req.schemaVersionId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      sdl: sdlSchema?.sdl || '',
      clientSchema: sdlSchema?.clientSchema || '',
    };
  });
}
