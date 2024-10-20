import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GetRouterTokensRequest,
  GetRouterTokensResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function getRouterTokens(
  opts: RouterOptions,
  req: GetRouterTokensRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GetRouterTokensResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GetRouterTokensResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        tokens: [],
      };
    }

    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' not found`,
        },
        tokens: [],
      };
    }

    const tokens = await fedRepo.getRouterTokens({
      organizationId: authContext.organizationId,
      federatedGraphId: federatedGraph.id,
      limit: 100,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      // Don't return the token, only the metadata
      tokens: tokens.map(({ token, ...rest }) => ({
        id: rest.id,
        name: rest.name,
        createdAt: rest.createdAt,
        creatorEmail: rest.creatorEmail || '',
      })),
    };
  });
}
