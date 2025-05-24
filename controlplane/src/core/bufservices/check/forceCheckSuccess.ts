import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  ForceCheckSuccessRequest,
  ForceCheckSuccessResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GitHubRepository } from '../../repositories/GitHubRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function forceCheckSuccess(
  opts: RouterOptions,
  req: ForceCheckSuccessRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<ForceCheckSuccessResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<ForceCheckSuccessResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);
    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
      };
    }

    if (!authContext.rbac.hasFederatedGraphWriteAccess(graph)) {
      throw new UnauthorizedError();
    }

    const check = await subgraphRepo.checkById({
      id: req.checkId,
      federatedGraphTargetId: graph.targetId,
      federatedGraphId: graph.id,
    });

    if (!check) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested check does not exist',
        },
      };
    }

    const githubDetails = await subgraphRepo.forceCheckSuccess(check.id);

    if (githubDetails && opts.githubApp) {
      const githubRepo = new GitHubRepository(opts.db, opts.githubApp);
      await githubRepo.markCheckAsSuccess({
        ...githubDetails,
      });
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
