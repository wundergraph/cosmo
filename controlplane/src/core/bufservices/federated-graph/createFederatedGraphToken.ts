import { PlainMessage } from '@bufbuild/protobuf';
import { HandlerContext } from '@connectrpc/connect';
import { EnumStatusCode } from '@wundergraph/cosmo-connect/dist/common/common_pb';
import {
  CreateFederatedGraphTokenRequest,
  CreateFederatedGraphTokenResponse,
} from '@wundergraph/cosmo-connect/dist/platform/v1/platform_pb';
import { GraphApiKeyJwtPayload } from '../../../types/index.js';
import { audiences, signJwtHS256 } from '../../crypto/jwt.js';
import { AuditLogRepository } from '../../repositories/AuditLogRepository.js';
import { FederatedGraphRepository } from '../../repositories/FederatedGraphRepository.js';
import { DefaultNamespace } from '../../repositories/NamespaceRepository.js';
import type { RouterOptions } from '../../routes.js';
import { enrichLogger, getLogger, handleError } from '../../util.js';

export function createFederatedGraphToken(
  opts: RouterOptions,
  req: CreateFederatedGraphTokenRequest,
  ctx: HandlerContext,
): Promise<PlainMessage<CreateFederatedGraphTokenResponse>> {
  let logger = getLogger(ctx, opts.logger);

  return handleError<PlainMessage<CreateFederatedGraphTokenResponse>>(ctx, logger, async () => {
    const authContext = await opts.authenticator.authenticate(ctx.requestHeader);
    logger = enrichLogger(ctx, logger, authContext);

    const fedGraphRepo = new FederatedGraphRepository(logger, opts.db, authContext.organizationId);
    const auditLogRepo = new AuditLogRepository(opts.db);

    req.namespace = req.namespace || DefaultNamespace;

    if (!authContext.hasWriteAccess) {
      return {
        response: {
          code: EnumStatusCode.ERR,
          details: `The user doesnt have the permissions to perform this operation`,
        },
        token: '',
      };
    }

    const graph = await fedGraphRepo.byName(req.graphName, req.namespace);
    if (!graph) {
      return {
        response: {
          code: EnumStatusCode.ERR_NOT_FOUND,
          details: `Federated graph '${req.graphName}' not found`,
        },
        token: '',
      };
    }

    const currToken = await fedGraphRepo.getRouterToken({
      federatedGraphId: graph.id,
      organizationId: authContext.organizationId,
      tokenName: req.tokenName,
    });
    if (currToken) {
      return {
        response: {
          code: EnumStatusCode.ERR_ALREADY_EXISTS,
          details: `Router token '${req.tokenName}' already exists`,
        },
        token: '',
      };
    }

    const tokenValue = await signJwtHS256<GraphApiKeyJwtPayload>({
      secret: opts.jwtSecret,
      token: {
        iss: authContext.userId,
        federated_graph_id: graph.id,
        aud: audiences.cosmoGraphKey, // to distinguish from other tokens
        organization_id: authContext.organizationId,
      },
    });

    const token = await fedGraphRepo.createToken({
      token: tokenValue,
      federatedGraphId: graph.id,
      tokenName: req.tokenName,
      createdBy: authContext.userId,
      organizationId: authContext.organizationId,
    });

    await auditLogRepo.addAuditLog({
      organizationId: authContext.organizationId,
      auditAction: 'graph_token.created',
      action: 'created',
      actorId: authContext.userId,
      targetId: graph.id,
      targetDisplayName: graph.name,
      targetType: 'federated_graph',
      actorDisplayName: authContext.userDisplayName,
      actorType: authContext.auth === 'api_key' ? 'api_key' : 'user',
      auditableDisplayName: token.name,
      auditableType: 'graph_token',
      targetNamespaceId: graph.namespaceId,
      targetNamespaceDisplayName: graph.namespace,
    });

    return {
      response: {
        code: EnumStatusCode.OK,
      },
      token: token.token,
    };
  });
}
