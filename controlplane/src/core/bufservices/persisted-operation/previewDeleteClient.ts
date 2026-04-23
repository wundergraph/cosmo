import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import type {
  PreviewDeleteClientRequest,
  PreviewDeleteClientResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { OperationsRepository } from '../../repositories/OperationsRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function previewDeleteClient(
  opts: RouterOptions,
  req: PreviewDeleteClientRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<PreviewDeleteClientResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<PreviewDeleteClientResponse>>(ctx, logger, async () => {
    req.namespace = req.namespace || DefaultNamespace;

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
        persistedOperationsCount: 0,
      };
    }

    if (authContext.organizationDeactivated || !authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const operationsRepo = new OperationsRepository(opts.db, federatedGraph.id);
    const preview = await operationsRepo.previewDeleteClient(req.clientName);

    if (!preview) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Client '${req.clientName}' does not exist`,
        },
        persistedOperationsCount: 0,
      };
    }

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      client: preview.client,
      persistedOperationsCount: preview.persistedOperationsCount,
    };
  });
}
