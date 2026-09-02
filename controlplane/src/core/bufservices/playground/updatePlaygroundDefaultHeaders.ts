import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  UpdatePlaygroundDefaultHeadersRequest,
  UpdatePlaygroundDefaultHeadersResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import type { PlainMessage } from '../../../types/index.js';
import { UnauthorizedError } from '../../errors/errors.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import { PlaygroundDefaultHeadersRepository } from '../../repositories/PlaygroundDefaultHeadersRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError, validatePlaygroundHeaders } from '../../util.js';

export function updatePlaygroundDefaultHeaders(
  opts: RouterOptions,
  req: UpdatePlaygroundDefaultHeadersRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<UpdatePlaygroundDefaultHeadersResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<UpdatePlaygroundDefaultHeadersResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    req.namespace = req.namespace || DefaultNamespace;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    if (!req.graphHeaders && !req.personalHeaders) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: 'At least one of graphHeaders or personalHeaders must be provided',
        },
      };
    }

    // Validate every present list up front so an invalid entry in one scope can
    // never leave the other scope's write persisted.
    for (const [headerList, scopeLabel] of [
      [req.graphHeaders, 'graph'],
      [req.personalHeaders, 'personal'],
    ] as const) {
      if (!headerList) {
        continue;
      }

      const error = validatePlaygroundHeaders(headerList.headers, scopeLabel);
      if (error) {
        return {
          response: {
            code: EnumStatusCode.ERR,
            details: error,
          },
        };
      }
    }

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const federatedGraph = await fedRepo.byName(req.federatedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.federatedGraphName}' not found`,
        },
      };
    }

    // Graph-level defaults are shared with the whole organization, so they need
    // write access. A personal row only needs read access to the graph.
    if (req.graphHeaders && !authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    if (req.personalHeaders && !authContext.rbac.hasFederatedGraphReadAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const playgroundRepo = new PlaygroundDefaultHeadersRepository(opts.db, authContext.organizationId);
    await playgroundRepo.update({
      federatedGraphId: federatedGraph.id,
      userId: authContext.userId,
      graphHeaders: req.graphHeaders?.headers.map((h) => ({ key: h.key, value: h.value })),
      personalHeaders: req.personalHeaders?.headers.map((h) => ({ key: h.key, value: h.value })),
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
