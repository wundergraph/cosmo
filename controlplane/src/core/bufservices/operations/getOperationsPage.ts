/* eslint-disable camelcase */
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationsPageRequest,
  GetOperationsPageResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { OperationsRepository } from '../../repositories/operations/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getOperationsPage(
  opts: RouterOptions,
  req: GetOperationsPageRequest,
  ctx: HandlerContext,
) : Promise<PlainMessage<GetOperationsPageResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationsPageResponse>>(ctx, logger, async () => {
    if (!opts.chClient) {
      return {
        response: {
          code: EnumStatusCode.ERR_ANALYTICS_DISABLED,
        },
        operations: [],
      };
    }

    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const graph = await fedGraphRepo.byName(req.federatedGraphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
        operations: [],
      };
    }


    const repo = new OperationsRepository(opts.chClient);
    const view = await repo.getOperationsPage({
      organizationId: authContext.organizationId,
      graphId: graph.id,
    })

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      ...view,
    };
  });
}
