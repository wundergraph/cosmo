import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type { RetirePersistedOperationRequest, RetirePersistedOperationResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb'
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function retirePersistedOperation(
  opts: RouterOptions,
  req: RetirePersistedOperationRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<RetirePersistedOperationResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<RetirePersistedOperationResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    // TODO: this is organization level permission, instead check if you have permission for subgraph
    if (authContext.organizationDeactivated || !authContext.rbac.isOrganizationAdminOrDeveloper) {
      throw new UnauthorizedError();
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);

    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
      };
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const operation = await operationsRepo.retirePersistedOperation({
      operationId: req.id,
    })

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      operation: operation
        ? {
            id: operation.operationId,
            name: operation.operationNames.join(''),
          }
        : undefined,
    };
  });
}
