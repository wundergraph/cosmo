/* eslint-disable camelcase */
import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetOperationsPageRequest,
  GetOperationsPageResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { RouterOptions } from '../../routes.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getOperationsPage(
  opts: RouterOptions,
  req: GetOperationsPageRequest,
  ctx: HandlerContext,
) : Promise<PlainMessage<GetOperationsPageResponse>> {
  console.log(`getOperationsPage called with request:`, req);
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetOperationsPageResponse>>(ctx, logger, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));

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
        filters: [],
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations: [],
    };
  });
}
