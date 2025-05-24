import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetAllOverridesRequest,
  GetAllOverridesResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function getAllOverrides(
  opts: RouterOptions,
  req: GetAllOverridesRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetAllOverridesResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetAllOverridesResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);

    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: 'Requested graph does not exist',
        },
        overrides: [],
      };
    }

    if (!authContext.rbac.hasFederatedGraphReadAccess(graph)) {
      throw new UnauthorizedError();
    }

    const operationsRepo = new OperationsRepository(opts.db, graph.id);

    const overrides = await operationsRepo.getConsolidatedOverridesView({
      namespaceId: graph.namespaceId,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      overrides,
    };
  });
}
