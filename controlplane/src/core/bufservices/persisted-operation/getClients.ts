import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import { GetClientsRequest, GetClientsResponse } from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getClients(
  opts: RouterOptions,
  req: GetClientsRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetClientsResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetClientsResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' does not exist`,
        },
        clients: [],
      };
    }
    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const clients = await operationsRepo.getRegisteredClients();

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      clients,
    };
  });
}
