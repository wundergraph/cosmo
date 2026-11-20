import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetGraphResourceOwnersRequest,
  GetGraphResourceOwnersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { GraphResourceOwnerRepository } from '../../repositories/GraphResourceOwnerRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import type { PlainMessage } from '../../../types/index.js';

export function getGraphResourceOwners(
  opts: RouterOptions,
  req: GetGraphResourceOwnersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetGraphResourceOwnersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetGraphResourceOwnersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const federatedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const ownerRepo = new GraphResourceOwnerRepository(opts.db, authContext.organizationId);

    const federatedGraph = await federatedGraphRepo.byName(req.federatedGraphName, req.namespace || DefaultNamespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph ${req.federatedGraphName} not found`,
        },
        owners: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const owners = await ownerRepo.explicitOwnersForGraph(federatedGraph.id);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      owners,
    };
  });
}
