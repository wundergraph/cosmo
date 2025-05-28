import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  GenerateRouterTokenRequest,
  GenerateRouterTokenResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphApiKeyJwtPayload } from '../../../types/index.js';
import { audiences, nowInSeconds, signJwtHS256 } from '../../crypto/jwt.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';
import { UnauthorizedError } from '../../errors/errors.js';

export function generateRouterToken(
  opts: RouterOptions,
  req: GenerateRouterTokenRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<GenerateRouterTokenResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<GenerateRouterTokenResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;
    if (authContext.organizationDeactivated) {
      throw new UnauthorizedError();
    }

    const federatedGraph = await fedRepo.byName(req.fedGraphName, req.namespace);
    if (!federatedGraph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.fedGraphName}' not found`,
        },
        token: '',
      };
    }

    // check whether the user is authorized to perform the action
    if (!authContext.rbac.hasFederatedGraphWriteAccess(federatedGraph)) {
      throw new UnauthorizedError();
    }

    const token = await signJwtHS256<GraphApiKeyJwtPayload>({
      secret: opts.jwtSecret,
      token: {
        iss: authContext.userId,
        federated_graph_id: federatedGraph.id,
        aud: audiences.cosmoGraphKey, // to distinguish from other tokens
        organization_id: authContext.organizationId,
        exp: nowInSeconds() + 5 * 60, // 5 minutes
      },
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      organizationSlug: authContext.organizationSlug,
      auditAction: 'router_config.fetched',
      action: 'fetched',
      actorId: authContext.userId,
      targetType: 'federated_graph',
      actorDisplayName: authContext.userDisplayName,
      apiKeyName: authContext.apiKeyName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      auditableDisplayName: federatedGraph.name,
      auditableType: 'router_config',
      targetNamespaceId: federatedGraph.namespaceId,
      targetNamespaceDisplayName: federatedGraph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      token,
    };
  });
}
