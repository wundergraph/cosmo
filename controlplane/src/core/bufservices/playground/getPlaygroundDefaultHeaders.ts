import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetPlaygroundDefaultHeadersRequest,
  GetPlaygroundDefaultHeadersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { PlaygroundDefaultHeadersRepository } from '../../repositories/PlaygroundDefaultHeadersRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getPlaygroundDefaultHeaders(
  opts: RouterOptions,
  req: GetPlaygroundDefaultHeadersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetPlaygroundDefaultHeadersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetPlaygroundDefaultHeadersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        graphHeaders: [],
        personalHeaders: [],
        canEditGraphHeaders: false,
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const playgroundRepo = new PlaygroundDefaultHeadersRepository(opts.db, authContext.organizationId);
    const { graphHeaders, personalHeaders } = await playgroundRepo.getByFederatedGraphId(
      federatedGraph.id,
      authContext.userId,
    );

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      graphHeaders,
      personalHeaders,
      canEditGraphHeaders:
        !authContext.organizationDeactivated && authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph),
    };
  });
}
