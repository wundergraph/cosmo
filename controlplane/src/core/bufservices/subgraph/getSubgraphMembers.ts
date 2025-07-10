import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetSubgraphMembersRequest,
  GetSubgraphMembersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { SubgraphRepository } from '../../repositories/SubgraphRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getSubgraphMembers(
  opts: RouterOptions,
  req: GetSubgraphMembersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetSubgraphMembersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetSubgraphMembersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const subgraphRepo = new SubgraphRepository(logger, opts.db, authContext.organizationId);

    // check if the subgraph exists
    const subgraph = await subgraphRepo.byName(req.subgraphName, req.namespace);
    if (!subgraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Subgraph ${req.subgraphName} not found`,
        },
        members: [],
      };
    }

    if (!authContext.rbac.hasSubGraphReadAccess(subgraph)) {
      throw new UnauthorizedError();
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      members: await subgraphRepo.getSubgraphMembers(subgraph.id),
    };
  });
}
