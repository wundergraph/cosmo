import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  DeleteRouterTokenRequest,
  DeleteRouterTokenResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function deleteRouterToken(
  opts: RouterOptions,
  req: DeleteRouterTokenRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<DeleteRouterTokenResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<DeleteRouterTokenResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;

    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const federatedGraph = await fedGraphRepo.byName(req.fedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' not found`,
        },
      };
    }

    // check if the user is authorized to perform the action
    await opts.authorizer.authorize({
      db: opts.db,
      graph: {
        targetId: federatedGraph.targetId,
        targetType: 'federatedGraph',
      },
      headers: ctx.requestHeader,
      authContext,
    });

    const currToken = await fedGraphRepo.getRouterToken({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      tokenName: req.tokenName,
    });

    if (!currToken) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Router token '${req.tokenName}' doesn't exist`,
        },
        token: '',
      };
    }

    await fedGraphRepo.deleteToken({
      federatedGraphId: federatedGraph.id,
      organizationId: authContext.organizationId,
      tokenName: req.tokenName,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'graph_token.deleted',
      action: 'deleted',
      actorId: authContext.userId,
      targetId: federatedGraph.id,
      targetDisplayName: federatedGraph.name,
      targetType: 'federated_graph',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      auditableDisplayName: currToken.name,
      auditableType: 'graph_token',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
    };
  });
}
