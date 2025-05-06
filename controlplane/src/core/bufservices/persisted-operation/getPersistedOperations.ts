import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetPersistedOperationsRequest,
  GetPersistedOperationsResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getPersistedOperations(
  opts: RouterOptions,
  req: GetPersistedOperationsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetPersistedOperationsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetPersistedOperationsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' does not exist`,
        },
        operations: [],
      };
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const operations = await operationsRepo.getPersistedOperations(req.clientId);

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operations: operations.map((op) => ({
        ...op,
        id: op.operationId,
      })),
    };
  });
}
